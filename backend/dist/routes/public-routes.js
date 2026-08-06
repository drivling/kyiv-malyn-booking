"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPublicRoutesRouter = createPublicRoutesRouter;
const express_1 = __importDefault(require("express"));
function createPublicRoutesRouter(options) {
    const r = express_1.default.Router();
    const { codeVersion } = options;
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
