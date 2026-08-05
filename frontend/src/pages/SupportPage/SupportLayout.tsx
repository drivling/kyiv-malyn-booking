import { NavLink, Outlet, useParams } from 'react-router-dom';
import {
  BOT_TOC,
  SUPPORT_PATH,
  SUPPORT_TOPICS,
  TELEGRAM_BOT_URL,
  TELEGRAM_BOT_USERNAME,
  isSupportTopicId,
} from './supportContent';
import './SupportPage.css';

/** Оболонка help-center: зліва навігація (desktop), зверху чипи (mobile) */
export function SupportLayout() {
  const { topicId } = useParams<{ topicId?: string }>();
  const showBotToc = isSupportTopicId(topicId) && topicId === 'bot';

  return (
    <div className={`support-shell${topicId ? '' : ' support-shell--hub'}`}>
      <aside className="support-side" aria-label="Розділи допомоги">
        <div className="support-side__inner">
          <NavLink
            to={SUPPORT_PATH}
            end
            className={({ isActive }) => `support-side__home${isActive ? ' is-active' : ''}`}
          >
            Центр допомоги
          </NavLink>
          <nav className="support-side__nav">
            {SUPPORT_TOPICS.map((t) => (
              <div key={t.id} className="support-side__group">
                <NavLink
                  to={`${SUPPORT_PATH}/${t.id}`}
                  className={({ isActive }) =>
                    `support-side__link${isActive ? ' is-active' : ''}`
                  }
                >
                  <span className="support-side__link-title">{t.title}</span>
                  <span className="support-side__link-blurb">{t.blurb}</span>
                </NavLink>
                {showBotToc && t.id === 'bot' && (
                  <ul className="support-side__toc">
                    {BOT_TOC.map((item) => (
                      <li key={item.id}>
                        <a href={`#${item.id}`}>{item.label}</a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </nav>
          <a
            className="support-side__cta"
            href={TELEGRAM_BOT_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Відкрити @{TELEGRAM_BOT_USERNAME}
          </a>
        </div>
      </aside>

      <nav className="support-chips" aria-label="Теми допомоги">
        <NavLink
          to={SUPPORT_PATH}
          end
          className={({ isActive }) => `support-chip${isActive ? ' is-active' : ''}`}
        >
          Усі теми
        </NavLink>
        {SUPPORT_TOPICS.map((t) => (
          <NavLink
            key={t.id}
            to={`${SUPPORT_PATH}/${t.id}`}
            className={({ isActive }) => `support-chip${isActive ? ' is-active' : ''}`}
          >
            {t.shortTitle}
          </NavLink>
        ))}
      </nav>

      <div className="support-main">
        <Outlet />
      </div>
    </div>
  );
}
