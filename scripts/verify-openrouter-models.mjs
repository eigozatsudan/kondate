const raw = process.env.OPENROUTER_MODELS ?? "";
const models = raw
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

if (models.length === 0) fail("OPENROUTER_MODELS must not be empty");
if (new Set(models).size !== models.length) fail("OPENROUTER_MODELS contains duplicates");
for (const model of models) {
  if (model === "openrouter/auto" || !model.endsWith(":free")) {
    fail(`OPENROUTER_MODELS contains a non-free model: ${model}`);
  }
}

if (process.exitCode !== 1 && process.argv.includes("--remote")) {
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers: process.env.OPENROUTER_API_KEY
      ? { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }
      : {},
  });
  if (!response.ok) {
    fail(`OpenRouter Models API returned ${response.status}`);
  } else {
    const payload = await response.json();
    const index = new Map(payload.data.map((model) => [model.id, model]));
    for (const id of models) {
      const model = index.get(id);
      if (!model) {
        fail(`Configured OpenRouter model is unavailable: ${id}`);
      } else if (!model.supported_parameters?.includes("structured_outputs")) {
        fail(`Configured model lacks structured_outputs: ${id}`);
      }
    }
  }
}

if (process.exitCode !== 1) {
  process.stdout.write(`Verified ${models.length} free OpenRouter model(s).\n`);
}
