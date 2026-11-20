# KUNA.SKYSTREAM

Лендинг-каталог Starlink на Cloudflare Workers.

- Сайт: `public/index.html`
- Админка: `/admin` (`public/admin.html`) — цены, товары, фото, телефон
- API и хранение: `worker.js` + KV `kuna-skystream-catalog` (binding `CATALOG`)
- Пароль админки: секрет `ADMIN_PASSWORD` в Cloudflare (Settings → Variables and Secrets)
- Каталог по умолчанию (пока в админке ничего не сохранено): `public/catalog-default.js`
