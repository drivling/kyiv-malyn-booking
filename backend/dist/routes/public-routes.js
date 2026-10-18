"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPENAPI_PUBLIC_PATH = void 0;
exports.createPublicRoutesRouter = createPublicRoutesRouter;
const express_1 = __importDefault(require("express"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
/**
 * OpenAPI 3.1 публічних ендпоінтів (Docs/transport-open-protocols-2026-10.md, фаза 2). Файл лежить у
 * `backend/openapi/` — однаковий відносний шлях із `src/routes` (ts-node, vitest) і з `dist/routes` (прод).
 */
exports.OPENAPI_PUBLIC_PATH = node_path_1.default.resolve(__dirname, '../../openapi/public.yaml');
function createPublicRoutesRouter(options) {
    const r = express_1.default.Router();
    const { codeVersion } = options;
    let openapiYaml = null;
    r.get('/health', (_req, res) => {
        res.set({
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            Pragma: 'no-cache',
        });
        res.json({
            status: 'ok',
            version: 3,
            viber: true,
            codeVersion,
            deploymentId: process.env.RAILWAY_DEPLOYMENT_ID ?? null,
            cwd: process.cwd(),
        });
    });
    /** Машинний опис публічного API; канонічна адреса — https://malin.kiev.ua/openapi.yaml (302 сюди) */
    r.get('/openapi.yaml', (_req, res) => {
        try {
            if (openapiYaml == null)
                openapiYaml = node_fs_1.default.readFileSync(exports.OPENAPI_PUBLIC_PATH, 'utf8');
        }
        catch (e) {
            console.error('[GET /openapi.yaml] cannot read', exports.OPENAPI_PUBLIC_PATH, e);
            res.status(500).json({ error: 'OpenAPI document is unavailable' });
            return;
        }
        res.set({ 'Content-Type': 'application/yaml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
        res.send(openapiYaml);
    });
    r.get('/status', (_req, res) => {
        res.json({
            status: 'ok',
            version: 3,
            viber: true,
            codeVersion,
            deploymentId: process.env.RAILWAY_DEPLOYMENT_ID ?? null,
            cwd: process.cwd(),
        });
    });
    return r;
}
