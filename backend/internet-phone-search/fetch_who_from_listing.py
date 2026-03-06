"""
Завантажує сторінку оголошення і витягує «хто» — ім'я/підпис продавця (контакт), а не назву оголошення.
"""
from __future__ import annotations

import re
from typing import Optional

import requests
from bs4 import BeautifulSoup

USER_AGENT = "Mozilla/5.0 (compatible; MalynRoutesBot/1.0; +https://malin.kiev.ua)"
TIMEOUT = 12


def fetch_html(url: str) -> Optional[str]:
    try:
        r = requests.get(
            url,
            headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml,*/*;q=0.8"},
            timeout=TIMEOUT,
        )
        r.raise_for_status()
        return r.text
    except Exception:
        return None


def _normalize_who(s: str) -> str:
    s = s.strip()
    s = re.sub(r"\s+", " ", s)
    if len(s) > 120:
        s = s[:117] + "..."
    return s


def extract_who_olx(html: str) -> Optional[str]:
    """OLX: шукаємо контакт/ім'я продавця в блоці контактів або в тексті."""
    soup = BeautifulSoup(html, "lxml")
    # Типові підписи на OLX: "Контакт: Олександр", "Продавець Олександр", ім'я в блоці з контактом
    for label in ("Контакт", "Продавець", "Seller", "Контактна особа"):
        for el in soup.find_all(string=re.compile(re.escape(label), re.I)):
            parent = el.parent
            if parent:
                text = parent.get_text(separator=" ", strip=True)
                # Прибираємо сам лейбл і залишаємо ім'я
                for sep in (":", ":", "—", "-"):
                    if sep in text:
                        part = text.split(sep, 1)[-1].strip()
                        if part and 2 <= len(part) <= 100 and not part.startswith("+") and not part.startswith("0"):
                            return _normalize_who(part)
    # Пошук по data-атрибутах або класах (часто user-name, seller-name, contact-name)
    for sel in ("[data-testid='user-name']", ".user-name", ".seller-name", ".contact-name", "[class*='userName']"):
        for el in soup.select(sel):
            t = el.get_text(strip=True)
            if t and 2 <= len(t) <= 100:
                return _normalize_who(t)
    # Останній варіант: шукати рядок типу "Контакт: Ім'я" в усьому тексті
    text = soup.get_text(separator=" ")
    m = re.search(r"(?:Контакт|Продавець|Seller)\s*[:\-]\s*([А-Яа-яІіЇїЄє\s]{2,50})", text, re.I)
    if m:
        return _normalize_who(m.group(1))
    return None


def extract_who_auto_ria(html: str) -> Optional[str]:
    """AUTO.RIA: ім'я продавця в блоці контакту."""
    soup = BeautifulSoup(html, "lxml")
    for label in ("Продавець", "Контакт", "Seller", "Ім'я"):
        for el in soup.find_all(string=re.compile(re.escape(label), re.I)):
            parent = el.parent
            if parent:
                text = parent.get_text(separator=" ", strip=True)
                for sep in (":", ":", "—", "-"):
                    if sep in text:
                        part = text.split(sep, 1)[-1].strip()
                        if part and 2 <= len(part) <= 100:
                            return _normalize_who(part)
    for sel in (".seller_name", ".seller-name", "[class*='sellerName']", ".seller_info .name"):
        for el in soup.select(sel):
            t = el.get_text(strip=True)
            if t and 2 <= len(t) <= 100:
                return _normalize_who(t)
    text = soup.get_text(separator=" ")
    m = re.search(r"(?:Продавець|Контакт)\s*[:\-]\s*([А-Яа-яІіЇїЄє\s]{2,50})", text, re.I)
    if m:
        return _normalize_who(m.group(1))
    return None


def extract_who_dom_ria(html: str) -> Optional[str]:
    """DOM.RIA: аналогічно — контакт/агент."""
    soup = BeautifulSoup(html, "lxml")
    for label in ("Агент", "Контакт", "Менеджер", "Продавець"):
        for el in soup.find_all(string=re.compile(re.escape(label), re.I)):
            parent = el.parent
            if parent:
                text = parent.get_text(separator=" ", strip=True)
                for sep in (":", ":", "—", "-"):
                    if sep in text:
                        part = text.split(sep, 1)[-1].strip()
                        if part and 2 <= len(part) <= 100:
                            return _normalize_who(part)
    for sel in (".agent_name", ".contact-name", "[class*='agentName']"):
        for el in soup.select(sel):
            t = el.get_text(strip=True)
            if t and 2 <= len(t) <= 100:
                return _normalize_who(t)
    text = soup.get_text(separator=" ")
    m = re.search(r"(?:Агент|Контакт|Менеджер)\s*[:\-]\s*([А-Яа-яІіЇїЄє\s]{2,50})", text, re.I)
    if m:
        return _normalize_who(m.group(1))
    return None


def fetch_who(url: str, source: str) -> Optional[str]:
    """
    Завантажує сторінку оголошення і повертає «хто» (ім'я/підпис), або None.
    source: olx | auto_ria | dom_ria
    """
    html = fetch_html(url)
    if not html:
        return None
    if source == "olx":
        return extract_who_olx(html)
    if source == "auto_ria":
        return extract_who_auto_ria(html)
    if source == "dom_ria":
        return extract_who_dom_ria(html)
    return None
