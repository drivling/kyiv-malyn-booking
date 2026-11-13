"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_TRANSPORT_CITY = void 0;
exports.parseTransportCity = parseTransportCity;
exports.resolveTransportCity = resolveTransportCity;
const catalog_cache_1 = require("./catalog-cache");
const require_admin_1 = require("./middleware/require-admin");
const site_domains_1 = require("./site-domains");
const transport_city_code_1 = require("./transport-city-code");
Object.defineProperty(exports, "DEFAULT_TRANSPORT_CITY", { enumerable: true, get: function () { return transport_city_code_1.DEFAULT_TRANSPORT_CITY; } });
/**
 * ?city= / body.city → канонічний код міста. Порожньо — Малин; інакше код міста з активним сайтом
 * (site-domains.ts), без урахування регістру. null — такого міста нема.
 */
function parseTransportCity(raw) {
    if (raw === undefined || raw === null || raw === '')
        return transport_city_code_1.DEFAULT_TRANSPORT_CITY;
    if (typeof raw !== 'string')
        return null;
    const wanted = raw.trim().toLowerCase();
    if (!wanted)
        return transport_city_code_1.DEFAULT_TRANSPORT_CITY;
    const site = Object.values(site_domains_1.SITES).find((s) => s.active && s.cityCode.toLowerCase() === wanted);
    return site ? site.cityCode : null;
}
/**
 * Чи можна цьому запиту читати / писати дані міста. null — відповідати 404 (нема такого міста або воно ще
 * не опубліковане, а запит не від адміна). Малин не потребує звернення до бази.
 */
async function resolveTransportCity(prisma, req, raw) {
    const cityCode = parseTransportCity(raw);
    if (!cityCode)
        return null;
    if (cityCode === transport_city_code_1.DEFAULT_TRANSPORT_CITY)
        return { cityCode, isDefault: true, adminOnly: false };
    const point = (await (0, catalog_cache_1.getCatalog)(prisma)).pointByCode(cityCode);
    if (point?.hasLocalTransport === true)
        return { cityCode, isDefault: false, adminOnly: false };
    return (0, require_admin_1.isAdminRequest)(req) ? { cityCode, isDefault: false, adminOnly: true } : null;
}
