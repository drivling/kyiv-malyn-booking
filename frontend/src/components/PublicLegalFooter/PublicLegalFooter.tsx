import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { SiteOwnerFooterLine } from '@/components/SiteOwnerFooterLine/SiteOwnerFooterLine';
import {
  COMPANY_DEVELOPER_PREFIX,
  COMPANY_FOOTER_SUFFIX,
  COMPANY_SHORT_NAME_UA,
  COMPANY_SITE_URL,
} from '@/legal/companyLegal';
import {
  PRIVACY_POLICY_PAGE_LINK,
  REFERRAL_PROMO_PAGE_LINK,
  TERMS_PAGE_LINK,
} from '@/legal/sitePublic';
import { SUPPORT_PATH } from '@/pages/SupportPage';
import './PublicLegalFooter.css';

/**
 * Підвал з реквізитами. `collapsible` (поки лише «Доведе»): видно тільки рядок розробника з кнопкою «Більше»,
 * решта — «під катом». Розгорнутий лишається, доки людина не згорне його сама (кнопка чи Esc) або не повернеться
 * до справи: почне друкувати в полі поза підвалом чи перейде на іншу адресу (нова відповідь, інша сторінка).
 * Від простого кліку деінде не згортається: підвал унизу сторінки, і його зникнення зсунуло б сторінку під
 * курсором саме в мить кліку.
 */
export const PublicLegalFooter: React.FC<{ collapsible?: boolean }> = ({ collapsible = false }) => {
  const [open, setOpen] = useState(false);
  const footer = useRef<HTMLElement>(null);
  const more = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const moreId = useId();
  const { pathname, search } = useLocation();

  // інша адреса — згорнути
  useEffect(() => {
    setOpen(false);
  }, [pathname, search]);

  useEffect(() => {
    if (!collapsible || !open) return;
    // розгорнуте має бути видно: підвал — останнє на сторінці, нові рядки зʼявляються під кнопкою
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    more.current?.scrollIntoView?.({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });

    const onInput = (e: Event) => {
      if (!(e.target instanceof Node && footer.current?.contains(e.target))) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && e.target instanceof Node && footer.current?.contains(e.target)) {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    document.addEventListener('input', onInput, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [collapsible, open]);

  const links = (
    <p className="public-legal-footer-line public-legal-footer-links">
      <Link to={SUPPORT_PATH} className="public-legal-footer-link">
        Допомога
      </Link>
      {' · '}
      <Link to={PRIVACY_POLICY_PAGE_LINK} className="public-legal-footer-link">
        Політика конфіденційності
      </Link>
      {' · '}
      <Link to={TERMS_PAGE_LINK} className="public-legal-footer-link">
        Умови користування
      </Link>
      {' · '}
      <Link to={REFERRAL_PROMO_PAGE_LINK} className="public-legal-footer-link">
        Акція «Приведи друга»
      </Link>
    </p>
  );
  const owner = <SiteOwnerFooterLine paragraphClassName="public-legal-footer-line" linkClassName="public-legal-footer-link" />;
  // Той самий власник, інший сайт: звичайне посилання без nofollow (SEO-план 4.6)
  const developer = (
    <p className={`public-legal-footer-line${collapsible ? ' public-legal-footer-dev' : ''}`}>
      {COMPANY_DEVELOPER_PREFIX}
      <a href={COMPANY_SITE_URL} className="public-legal-footer-link">
        {COMPANY_SHORT_NAME_UA}
      </a>
      {COMPANY_FOOTER_SUFFIX}
      {collapsible ? (
        <button
          ref={toggle}
          type="button"
          className="public-legal-footer-toggle"
          aria-expanded={open}
          aria-controls={moreId}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'Згорнути' : 'Більше'}
        </button>
      ) : null}
    </p>
  );

  return (
    <footer ref={footer} className={`public-legal-footer${collapsible ? ' public-legal-footer--fold' : ''}`} role="contentinfo">
      <div className="public-legal-footer-inner">
        {collapsible ? (
          <>
            {developer}
            <div ref={more} id={moreId} className="public-legal-footer-more" hidden={!open}>
              {links}
              {owner}
            </div>
          </>
        ) : (
          <>
            {links}
            {owner}
            {developer}
          </>
        )}
      </div>
    </footer>
  );
};
