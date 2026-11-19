import React from 'react';
import { Navigate } from 'react-router-dom';
import { AdminSectionHeader, AdminSectionNav } from '../kit';
import DovedeLogTab from '../DovedeLogTab';
import { DovedeCityPanel } from '../DovedeCityPanel';
import { DovedeDictionarySection } from './DovedeDictionarySection';
import { DovedeLearnSection } from './DovedeLearnSection';
import { DovedeOverview } from './DovedeOverview';
import { DovedeSettingsSection } from './DovedeSettingsSection';
import { DOVEDE_ADMIN_BASE, DOVEDE_SECTIONS, isDovedeSection } from './sections';
import '../DovedeLogTab.css';
import './DovedeTab.css';

/**
 * Вкладка «Доведе» в адмінці (Docs/dovede-admin-roadmap.md, крок 1): розділи з власними адресами
 * `/admin/dovede/<розділ>` замість одного довгого стовпчика. `section` — другий сегмент адреси з `AdminPage`;
 * невідомий розділ веде на «Огляд».
 */
const DovedeTab: React.FC<{ section?: string }> = ({ section = '' }) => {
  if (!isDovedeSection(section)) return <Navigate to={DOVEDE_ADMIN_BASE} replace />;

  return (
    <div className="dovede-log dovede-tab">
      <AdminSectionNav base={DOVEDE_ADMIN_BASE} sections={DOVEDE_SECTIONS} label="Розділи «Доведе»" />
      {section === '' ? <DovedeOverview /> : null}
      {section === 'questions' ? <DovedeLogTab /> : null}
      {section === 'dictionary' ? <DovedeDictionarySection /> : null}
      {section === 'city' ? (
        <>
          <AdminSectionHeader title="Місто" purpose="Дороги містом у Києві й Житомирі: що вже знаємо, що питають і архів." />
          <DovedeCityPanel defaultOpen />
        </>
      ) : null}
      {section === 'learning' ? <DovedeLearnSection /> : null}
      {section === 'settings' ? <DovedeSettingsSection /> : null}
    </div>
  );
};

export default DovedeTab;
