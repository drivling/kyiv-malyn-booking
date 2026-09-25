"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAdminDzhuraRouter = createAdminDzhuraRouter;
/**
 * Адмін-API «Джури» (/admin/dzhura/*): чати, прапорці, задачі для слухача, експорт JSON.
 * У Telegram звідси не ходимо — все через таблиці Dzhura*, які обробляє Python-слухач.
 */
const express_1 = __importDefault(require("express"));
const require_admin_1 = require("../middleware/require-admin");
const lunch_listener_1 = require("../lunch-listener");
const dzhura_1 = require("../dzhura");
function sendError(res, where, e) {
    if (e instanceof dzhura_1.DzhuraHttpError) {
        res.status(e.status).json({ error: e.message });
        return;
    }
    console.error(`❌ ${where}:`, e);
    res.status(500).json({ error: 'Внутрішня помилка' });
}
function parseId(raw) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0)
        throw new dzhura_1.DzhuraHttpError(400, 'Некоректний id');
    return id;
}
function createAdminDzhuraRouter(deps) {
    const { prisma } = deps;
    const listenerWanted = deps.listenerWanted ?? lunch_listener_1.isLunchListenerWanted;
    const r = express_1.default.Router();
    /** Стан слухача: чи взагалі має працювати і чи живий (heartbeat < 60 с) */
    r.get('/admin/dzhura/status', require_admin_1.requireAdmin, async (_req, res) => {
        try {
            res.json(await (0, dzhura_1.getStatus)(prisma, listenerWanted()));
        }
        catch (e) {
            sendError(res, 'GET /admin/dzhura/status', e);
        }
    });
    /** Список чатів (за замовчуванням групи й супергрупи; ?kind=all — усе) */
    r.get('/admin/dzhura/chats', require_admin_1.requireAdmin, async (req, res) => {
        try {
            res.json(await (0, dzhura_1.listChats)(prisma, (0, dzhura_1.parseKindsFilter)(req.query.kind)));
        }
        catch (e) {
            sendError(res, 'GET /admin/dzhura/chats', e);
        }
    });
    /** Прапорці «Читати» / «В Обране» */
    r.patch('/admin/dzhura/chats/:id', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const id = parseId(req.params.id);
            res.json(await (0, dzhura_1.updateChatFlags)(prisma, id, (0, dzhura_1.parseChatPatch)(req.body)));
        }
        catch (e) {
            sendError(res, 'PATCH /admin/dzhura/chats/:id', e);
        }
    });
    /** Перегляд збережених повідомлень: новіші першими, ?from&to, ?q, курсор ?beforeId */
    r.get('/admin/dzhura/chats/:id/messages', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const id = parseId(req.params.id);
            const page = await (0, dzhura_1.listMessages)(prisma, id, (0, dzhura_1.parseMessagesQuery)(req.query));
            res.json(page);
        }
        catch (e) {
            sendError(res, 'GET /admin/dzhura/chats/:id/messages', e);
        }
    });
    /** Повернути невдалі дублі в «Обране» (за тиждень) у чергу */
    r.post('/admin/dzhura/queue/retry-failed', require_admin_1.requireAdmin, async (_req, res) => {
        try {
            const requeued = await (0, dzhura_1.retryFailedSaved)(prisma);
            res.json({ requeued });
        }
        catch (e) {
            sendError(res, 'POST /admin/dzhura/queue/retry-failed', e);
        }
    });
    /** Експорт повідомлень чату за період (доби Києва) у JSON-файл */
    r.get('/admin/dzhura/chats/:id/export', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const id = parseId(req.params.id);
            const { from, to } = (0, dzhura_1.validateDateRange)(req.query.from, req.query.to);
            const payload = await (0, dzhura_1.buildChatExport)(prisma, id, from, to);
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${(0, dzhura_1.exportFileName)(payload.chat, from, to)}"`);
            res.send(JSON.stringify(payload, dzhura_1.bigintReplacer, 2));
        }
        catch (e) {
            sendError(res, 'GET /admin/dzhura/chats/:id/export', e);
        }
    });
    /** Задача для слухача: {type:'sync_dialogs'} | {type:'backfill', chatId, from, to} */
    r.post('/admin/dzhura/jobs', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const job = await (0, dzhura_1.createJob)(prisma, (0, dzhura_1.parseJobRequest)(req.body));
            res.status(201).json({ job });
        }
        catch (e) {
            sendError(res, 'POST /admin/dzhura/jobs', e);
        }
    });
    r.get('/admin/dzhura/jobs', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '10'), 10) || 10, 1), 50);
            res.json(await (0, dzhura_1.listJobs)(prisma, limit));
        }
        catch (e) {
            sendError(res, 'GET /admin/dzhura/jobs', e);
        }
    });
    r.get('/admin/dzhura/jobs/:id', require_admin_1.requireAdmin, async (req, res) => {
        try {
            res.json(await (0, dzhura_1.getJob)(prisma, parseId(req.params.id)));
        }
        catch (e) {
            sendError(res, 'GET /admin/dzhura/jobs/:id', e);
        }
    });
    return r;
}
