/* Strip token before telegram modules load so imports do not start polling. */
delete process.env.TELEGRAM_BOT_TOKEN;
