/* Strip token before telegram modules load so imports do not start polling. */
delete process.env.TELEGRAM_BOT_TOKEN;
/* «Доведе»: без ключа тести ніколи не ходять до Claude API (dovede/understand.ts). */
if (process.env.DOVEDE_EVAL !== '1') delete process.env.ANTHROPIC_API_KEY; // ручний прогін: dovede/eval.test.ts
