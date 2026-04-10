"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPublicRoutesRouter = createPublicRoutesRouter;
const express_1 = __importDefault(require("express"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
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
    r.get('/localtransport/data', (_req, res) => {
        try {
            const dataDir = path_1.default.join(__dirname, '..', '..', 'localtransport-data');
            const transportPath = path_1.default.join(dataDir, 'malyn_transport.json');
            const coordsPath = path_1.default.join(dataDir, 'stops_coords.json');
            const segmentsPath = path_1.default.join(dataDir, 'segmentDurations.json');
            const transport = JSON.parse(fs_1.default.readFileSync(transportPath, 'utf8'));
            const coords = JSON.parse(fs_1.default.readFileSync(coordsPath, 'utf8'));
            const segments = JSON.parse(fs_1.default.readFileSync(segmentsPath, 'utf8'));
            res.set({
                'Cache-Control': 'public, max-age=300',
            });
            res.json({
                transport,
                coords,
                segments,
            });
        }
        catch (error) {
            console.error('❌ /localtransport/data error:', error);
            res.status(500).json({ error: 'Failed to load local transport data' });
        }
    });
    return r;
}
