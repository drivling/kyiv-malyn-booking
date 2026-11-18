import React, { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getRouteLabel } from '@/utils/constants';
import { AdminSectionHeader } from '../kit';
import { DovedeSynonymsPanel } from '../DovedeSynonymsPanel';
import { DovedePickupsPanel } from '../DovedePickupsPanel';
import { dovedePath } from './sections';
import { useMalynStops } from './useMalynStops';

/**
 * Розділ «Словник» (/admin/dovede/dictionary): синоніми місць і примітки водіїв про посадку. `?word=` — слово, яке
 * власник узяв навчити в «Питаннях людей» чи «Огляді»: воно одразу стоїть у формі.
 */
export const DovedeDictionarySection: React.FC = () => {
  const [params] = useSearchParams();
  const word = params.get('word')?.trim() ?? '';
  const stops = useMalynStops();
  // той самий обʼєкт, поки слово в адресі те саме, — інакше форма заповнювалась би заново з кожним рендером
  const seed = useMemo(() => (word ? { word, n: 1 } : null), [word]);

  return (
    <>
      <AdminSectionHeader
        title="Словник"
        purpose={
          <>
            Слова, якими люди називають місця. Невпізнані — у розділі <Link to={dovedePath('questions', { only: 'unknown' })}>«Питання людей»</Link>.
          </>
        }
      />
      <DovedeSynonymsPanel stops={stops} seed={seed} />
      <DovedePickupsPanel stops={stops} routeLabel={getRouteLabel} />
    </>
  );
};
