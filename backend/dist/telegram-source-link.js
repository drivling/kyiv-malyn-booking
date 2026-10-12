"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTelegramMessageLink = buildTelegramMessageLink;
exports.describeListingOrigin = describeListingOrigin;
function buildTelegramMessageLink(o) {
    const chat = o.sourceChat?.trim().replace(/^@/, '');
    if (!chat || !o.sourceMessageId)
        return null;
    return o.sourceTopicId
        ? `https://t.me/${chat}/${o.sourceTopicId}/${o.sourceMessageId}`
        : `https://t.me/${chat}/${o.sourceMessageId}`;
}
/** "PoDoroguem/6" або "Korosten_Kyiv"; null — походження невідоме. */
function describeListingOrigin(o) {
    const chat = o.sourceChat?.trim().replace(/^@/, '');
    if (!chat)
        return null;
    return o.sourceTopicId ? `${chat}/${o.sourceTopicId}` : chat;
}
