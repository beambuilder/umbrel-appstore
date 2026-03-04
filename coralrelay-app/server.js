const express = require("express");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const UNI_API_URL = process.env.UNI_API_URL;
const UNI_API_KEY = process.env.UNI_API_KEY;

if (!UNI_API_URL) {
  console.warn("WARNING: UNI_API_URL is not set. Proxy requests will fail.");
}
if (!UNI_API_KEY) {
  console.warn("WARNING: UNI_API_KEY is not set. Proxy requests will fail.");
}

app.use(express.json());
app.use("/", express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// GET /v1/models — hardcoded model list in OpenAI format
// ---------------------------------------------------------------------------
app.get("/v1/models", (_req, res) => {
  res.json({
    object: "list",
    data: [
      { id: "gpt-5.2", object: "model", owned_by: "uni-proxy" },
      { id: "gpt-5.1", object: "model", owned_by: "uni-proxy" },
      { id: "gpt-5", object: "model", owned_by: "uni-proxy" },
      { id: "o3", object: "model", owned_by: "uni-proxy" },
      { id: "gpt-4.1", object: "model", owned_by: "uni-proxy" },
      { id: "o4-mini", object: "model", owned_by: "uni-proxy" },
      { id: "o3-mini", object: "model", owned_by: "uni-proxy" },
      { id: "o1", object: "model", owned_by: "uni-proxy" },
      { id: "gpt-4o-mini", object: "model", owned_by: "uni-proxy" },
      { id: "gpt-4o", object: "model", owned_by: "uni-proxy" },
      { id: "gpt-4-turbo", object: "model", owned_by: "uni-proxy" },
      { id: "gpt-4", object: "model", owned_by: "uni-proxy" },
      { id: "gpt-3.5-turbo-0125", object: "model", owned_by: "uni-proxy" },
    ],
  });
});

// ---------------------------------------------------------------------------
// GET /api/status — connectivity check to the university API
// ---------------------------------------------------------------------------
app.get("/api/status", async (_req, res) => {
  if (!UNI_API_URL || !UNI_API_KEY) {
    return res.json({ status: "disconnected", error: "UNI_API_URL or UNI_API_KEY not configured" });
  }
  try {
    const response = await fetch(`${UNI_API_URL}/api/v1/chat/send`, {
      method: "HEAD",
      headers: { Authorization: `Bearer ${UNI_API_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
    // Any response (even 405) means the server is reachable
    res.json({ status: "connected" });
  } catch (err) {
    res.json({ status: "disconnected", error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Helper: generate a chat completion ID
// ---------------------------------------------------------------------------
function generateId() {
  return "chatcmpl-" + crypto.randomBytes(12).toString("hex");
}

// ---------------------------------------------------------------------------
// POST /v1/chat/completions — main translation endpoint
// ---------------------------------------------------------------------------
app.post("/v1/chat/completions", async (req, res) => {
  try {
    const { model, messages, stream } = req.body;

    // Extract last user message as prompt
    let prompt = "";
    let customInstructions = "";

    for (const msg of messages) {
      if (msg.role === "system") {
        customInstructions = msg.content;
      }
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        prompt = messages[i].content;
        break;
      }
    }

    // Build university API request body
    const uniBody = {
      model,
      prompt,
      customInstructions: customInstructions || undefined,
      hideCustomInstructions: true,
      thread: null,
    };

    const uniResponse = await fetch(`${UNI_API_URL}/api/v1/chat/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${UNI_API_KEY}`,
      },
      body: JSON.stringify(uniBody),
    });

    if (!uniResponse.ok) {
      const errText = await uniResponse.text();
      return res.status(uniResponse.status).json({
        error: {
          message: errText || "University API error",
          type: "upstream_error",
          code: uniResponse.status,
        },
      });
    }

    const completionId = generateId();
    const created = Math.floor(Date.now() / 1000);

    if (stream) {
      // ----- Streaming mode -----
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      const reader = uniResponse.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          // Keep the last (possibly incomplete) line in the buffer
          buffer = lines.pop();

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            let parsed;
            try {
              parsed = JSON.parse(trimmed);
            } catch {
              continue;
            }

            if (parsed.type === "start") {
              const chunk = {
                id: completionId,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [
                  {
                    index: 0,
                    delta: { role: "assistant", content: "" },
                    finish_reason: null,
                  },
                ],
              };
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            } else if (parsed.type === "chunk" && parsed.content != null) {
              const chunk = {
                id: completionId,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [
                  {
                    index: 0,
                    delta: { content: parsed.content },
                    finish_reason: null,
                  },
                ],
              };
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            } else if (parsed.type === "done") {
              const chunk = {
                id: completionId,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [
                  {
                    index: 0,
                    delta: {},
                    finish_reason: "stop",
                  },
                ],
                usage: {
                  prompt_tokens: parsed.promptTokens || 0,
                  completion_tokens: parsed.responseTokens || 0,
                  total_tokens: parsed.totalTokens || 0,
                },
              };
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
              res.write("data: [DONE]\n\n");
            }
          }
        }
      } catch (streamErr) {
        console.error("Stream reading error:", streamErr.message);
      } finally {
        res.end();
      }
    } else {
      // ----- Non-streaming mode -----
      const reader = uniResponse.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";
      let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let parsed;
          try {
            parsed = JSON.parse(trimmed);
          } catch {
            continue;
          }

          if (parsed.type === "chunk" && parsed.content != null) {
            fullContent += parsed.content;
          } else if (parsed.type === "done") {
            usage = {
              prompt_tokens: parsed.promptTokens || 0,
              completion_tokens: parsed.responseTokens || 0,
              total_tokens: parsed.totalTokens || 0,
            };
          }
        }
      }

      res.json({
        id: completionId,
        object: "chat.completion",
        created,
        model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: fullContent },
            finish_reason: "stop",
          },
        ],
        usage,
      });
    }
  } catch (err) {
    console.error("Translation proxy error:", err.message);
    res.status(502).json({
      error: {
        message: "Failed to communicate with university API",
        type: "proxy_error",
        code: 502,
      },
    });
  }
});

app.listen(PORT, () => {
  console.log(`CoralRelay listening on port ${PORT}`);
  console.log(`University API URL: ${UNI_API_URL || "(not set)"}`);
});
