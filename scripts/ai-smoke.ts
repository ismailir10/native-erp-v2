import "dotenv/config";
import { aiConfig, OpenAiCompatibleProvider } from "@/lib/ai/provider";
import { COA_TEMPLATE } from "@/lib/coa/template";

/**
 * npm run ai:smoke — ONE real, capped LLM call (3 merchants) to verify AI_API_KEY / AI_MODEL.
 * Everything else in the repo runs offline. Prints the provider's error verbatim if the model id is wrong.
 */
async function main() {
  const cfg = aiConfig();
  if (!cfg.apiKey || !cfg.model) {
    console.error("Set AI_API_KEY and AI_MODEL in .env first (AI_BASE_URL defaults to OpenCode Zen).");
    process.exit(1);
  }
  const provider = new OpenAiCompatibleProvider(cfg);
  const accounts = COA_TEMPLATE.filter((a) => !a.isSuspense && !a.isRetained).map((a) => ({ code: a.code, name: a.name }));
  const t0 = Date.now();
  const res = await provider.classify(
    [
      { key: "CV SUMBER VAKSIN", direction: "OUT", sample: "TRSF E-BANKING DB CV SUMBER VAKSIN" },
      { key: "PT KIRIM CEPAT NUSANTARA ONGKIR", direction: "OUT", sample: "TRANSFER KE PT KIRIM CEPAT NUSANTARA ONGKIR" },
      { key: "PT MITRA UNGGAS SENTOSA", direction: "IN", sample: "TRSF E-BANKING CR PT MITRA UNGGAS SENTOSA" },
    ],
    accounts,
    "Grup Uji (agritech peternakan ayam)",
  );
  console.log(`model=${res.model} ${Date.now() - t0}ms tokens in/out=${res.promptTokens}/${res.completionTokens}`);
  console.table(res.answers);
  if (res.answers.length === 0) console.warn("No valid answers — check the model follows JSON instructions.");
}
main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
