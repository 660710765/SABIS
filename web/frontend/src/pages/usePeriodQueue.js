import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useRun } from '../components/toast.jsx';

// Loads the rounds in the given statuses and the detail of the selected one.
export function usePeriodQueue(statuses) {
  const run = useRun();
  const [list, setList] = useState(null);
  const [id, setId] = useState(null);
  const [detail, setDetail] = useState(null);

  const reload = useCallback(async (wantId) => {
    const l = await api('GET', `/api/periods?status=${statuses}`);
    const pick = l.some((p) => p.id === wantId) ? wantId : l[0]?.id ?? null;
    setList(l);
    setId(pick);
    setDetail(pick ? await api('GET', `/api/periods/${pick}`) : null);
  }, [statuses]);

  useEffect(() => { run(() => reload(null)); }, [reload, run]);

  return { list, id, detail, select: (n) => run(() => reload(n)), reload: () => reload(id), run };
}
