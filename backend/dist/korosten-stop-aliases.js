"use strict";
/**
 * Словник назв зупинок Коростеня: назва з проєкту 2025 / розкладу ради → офіційна зупинка зі stops.csv ради
 * (z-001…z-091). Спершу дослівний збіг, далі нормалізований (регістр, лапки, «вул.», «Завод», «(на вимогу)»,
 * порядок слів, назва в дужках), далі ручні підказки (stop-aliases.hints.json). Чисті функції.
 * Docs/korosten-transport-2026-11.md, фаза 2б.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopNameKeys = stopNameKeys;
exports.buildStopAliases = buildStopAliases;
exports.parseOfficialStops = parseOfficialStops;
const NOISE_WORDS = new Set(['вул', 'вулиця', 'пров', 'провулок', 'завод', 'кафе', 'пп', 'фабрика', 'ім', 'зупинка']);
function key(raw) {
    return raw
        .toLowerCase()
        .replace(/зупинка на вимогу|\(на вимогу\)/g, ' ')
        .replace(/[«»"“”„'’`]/g, ' ')
        .replace(/[^a-zа-яіїєґ0-9]+/g, ' ')
        .split(' ')
        .filter((w) => w && !NOISE_WORDS.has(w))
        .sort()
        .join(' ');
}
/** Ключі назви: уся назва, назва без дужок, вміст дужок */
function stopNameKeys(name) {
    const inner = [...name.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]);
    const outer = name.replace(/\([^)]*\)/g, ' ');
    return [...new Set([key(name), key(outer), ...inner.map(key)].filter(Boolean))];
}
function buildStopAliases(names, official, hints = {}) {
    const byUid = new Map(official.map((s) => [s.uid, s]));
    const byKey = new Map();
    for (const s of official) {
        for (const k of stopNameKeys(s.label)) {
            if (!byKey.has(k))
                byKey.set(k, new Set());
            byKey.get(k)?.add(s.uid);
        }
    }
    const sources = new Map();
    for (const { name, source } of names) {
        if (!sources.has(name))
            sources.set(name, new Set());
        sources.get(name)?.add(source);
    }
    const out = { stops: {}, newStops: [], unresolved: [], unusedOfficial: [] };
    const used = new Set();
    const alias = (name, uid, how, confirm) => {
        const stop = byUid.get(uid);
        if (!stop)
            throw new Error(`stop alias «${name}»: unknown uid ${uid}`);
        out.stops[name] = { uid, official: stop.label.trim(), how, confirm, sources: [...(sources.get(name) ?? [])].sort() };
        used.add(uid);
    };
    for (const name of [...sources.keys()].sort((a, b) => a.localeCompare(b, 'uk'))) {
        const src = [...(sources.get(name) ?? [])].sort();
        const hint = hints[name];
        if (hint) {
            if (hint.uid)
                alias(name, hint.uid, 'hint', hint.confirm !== false);
            else
                out.newStops.push({ name, tempId: '', sources: src });
            continue;
        }
        const exact = official.filter((s) => s.label.trim().toLowerCase() === name.trim().toLowerCase());
        if (exact.length === 1) {
            alias(name, exact[0].uid, 'exact', false);
            continue;
        }
        const candidates = new Set();
        for (const k of stopNameKeys(name))
            for (const uid of byKey.get(k) ?? [])
                candidates.add(uid);
        if (candidates.size === 1)
            alias(name, [...candidates][0], 'normalized', false);
        else
            out.unresolved.push({ name, candidates: [...candidates].sort(), sources: src });
    }
    out.newStops.forEach((s, i) => {
        s.tempId = `z-${101 + i}`;
    });
    out.unusedOfficial = official.map((s) => s.uid).filter((uid) => !used.has(uid));
    return out;
}
/** stops.csv ради: роздільник «;», поля uid, label, addressThoroughfare */
function parseOfficialStops(csv) {
    const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
    const header = lines[0].split(';');
    const col = (name) => header.indexOf(name);
    return lines.slice(1).map((line) => {
        const cells = line.split(';');
        return { uid: cells[col('uid')].trim(), label: cells[col('label')].trim(), street: (cells[col('addressThoroughfare')] ?? '').trim() };
    });
}
