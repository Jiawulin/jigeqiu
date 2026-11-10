import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { initialFlow, transition, type FlowEvent } from './flow';
import {
  claimWelcome, detectNewUser, mergeProgress, ONBOARDING_KEY, parseProgress, readProgress, updateProgressLocked,
  type ProgressPatch,
} from './progress';
import type { OnboardingEntry, OnboardingEvent, OnboardingTask } from './types';
import { hasWelcomeCookie, rememberWelcomeCookie, usesWelcomeCookie } from './welcome-cookie';
import { applicationStorage, mutateStorage } from '../../services/application-storage';

function snapshot() {
  try { return { eligible: detectNewUser(applicationStorage())
    && !(usesWelcomeCookie() && hasWelcomeCookie()), ...readProgress(applicationStorage()) }; }
  catch { return { eligible: false, ...readProgress({ getItem() { throw new Error(); }, setItem() {}, length: 0, key() { return null; } }) }; }
}

export function useOnboarding() {
  const [initial] = useState(snapshot);
  const progress = useRef(initial.progress);
  const eligible = useRef(initial.eligible);
  const welcomeRequest = useRef(0);
  const [flow, reduce] = useReducer(transition, initialFlow);
  const flowRef = useRef(flow);
  flowRef.current = flow;
  const dispatch = useCallback((event: FlowEvent) => {
    flowRef.current = transition(flowRef.current, event);
    reduce(event);
  }, []);
  const [saveFailed, setSaveFailed] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [showBackup, setShowBackup] = useState(false);
  const [cookieNotice, setCookieNotice] = useState<'saved' | 'failed' | null>(null);
  const noticesShown = useRef(new Set<string>());
  const notify = useCallback((kind: 'save' | 'tour' | 'cookie-saved' | 'cookie-failed') => {
    if (noticesShown.current.has(kind)) return;
    noticesShown.current.add(kind);
    if (kind === 'save') setSaveFailed(true);
    else if (kind === 'tour') setUnavailable(true);
    else setCookieNotice(kind === 'cookie-saved' ? 'saved' : 'failed');
  }, []);
  const rememberWelcome = useCallback(() => {
    notify(rememberWelcomeCookie() ? 'cookie-saved' : 'cookie-failed');
  }, [notify]);

  const save = useCallback((patch: ProgressPatch) => {
    progress.current = mergeProgress(progress.current, patch);
    // Cookie mode remembers exposure only, never unlocked full progress or assets.
    if (usesWelcomeCookie()) return;
    try {
      void updateProgressLocked(applicationStorage(), progress.current, navigator.locks, mutateStorage).then(result => {
        if (result.ok) progress.current = mergeProgress(progress.current, result.progress);
        else notify('save');
      }, () => notify('save'));
    } catch { notify('save'); }
  }, [notify]);
  const exit = useCallback(() => {
    if (flowRef.current.phase === 'welcome') save({ welcomeSkipped: true });
    dispatch({ type: 'exit' });
    setShowBackup(false);
  }, [save]);
  const start = useCallback((entry: OnboardingEntry, hasBookmarks: boolean) => {
    welcomeRequest.current++;
    eligible.current = false;
    setUnavailable(false);
    setShowBackup(false);
    if (usesWelcomeCookie() && !hasWelcomeCookie()
      && !noticesShown.current.has('cookie-failed')) rememberWelcome();
    dispatch({ type: 'start', entry, hasBookmarks });
  }, [rememberWelcome]);
  const offerWelcome = useCallback(() => {
    if (!eligible.current || flowRef.current.phase !== 'idle') return;
    eligible.current = false;
    const request = ++welcomeRequest.current;
    if (usesWelcomeCookie()) {
      if (hasWelcomeCookie()) return;
      rememberWelcome();
      dispatch({ type: 'welcome' });
      return;
    }
    try {
      void claimWelcome(applicationStorage(), navigator.locks, mutateStorage).then(result => {
        if (result.progress) progress.current = mergeProgress(progress.current, result.progress);
        if (request !== welcomeRequest.current || flowRef.current.phase !== 'idle') return;
        if (result.claimed) dispatch({ type: 'welcome' });
        else if (result.error) notify('save');
      }, () => notify('save'));
    } catch { notify('save'); }
    return () => { welcomeRequest.current++; };
  }, [notify, rememberWelcome]);
  const finish = useCallback((task: OnboardingTask, bookmarkId?: string) => {
    if (flowRef.current.phase !== 'task' || flowRef.current.task !== task) return;
    save({ tasks: { [task]: true } });
    if ((task === 'add' || task === 'import') && !progress.current.backupReminderShown) {
      setShowBackup(true);
    }
    dispatch({ type: 'success', task, bookmarkId });
  }, [save]);
  const onEvent = useCallback((event: OnboardingEvent) => {
    if (event.type === 'import-success') finish('import');
    if (event.type === 'import-stage' && event.stage === 'cancel') exit();
  }, [finish, exit]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== ONBOARDING_KEY || event.storageArea !== localStorage) return;
      const external = parseProgress(event.newValue);
      if (!external) return;
      eligible.current = false;
      progress.current = mergeProgress(progress.current, external);
      if (flowRef.current.phase === 'welcome') dispatch({ type: 'exit' });
    };
    window.addEventListener('storage', sync);
    const changed = () => {
      try {
        const external = parseProgress(applicationStorage().getItem(ONBOARDING_KEY));
        if (external) progress.current = mergeProgress(progress.current, external);
      } catch { notify('save'); }
    };
    window.addEventListener('application-storage-change', changed);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('application-storage-change', changed);
    };
  }, [notify]);
  return {
    flow, start, exit, finish, onEvent, offerWelcome, showBackup, saveFailed, unavailable, cookieNotice,
    cancelTask: useCallback(() => {
      if (flowRef.current.phase === 'task') exit();
    }, [exit]),
    backupDisplayed: useCallback(() => save({ backupReminderShown: true }), [save]),
    tourComplete: useCallback(() => {
      save({ tourCompleted: true });
      dispatch({ type: 'tour-complete' });
    }, [save]),
    fail: useCallback(() => { dispatch({ type: 'exit' }); notify('tour'); }, [notify]),
    dismissNotice: useCallback(() => { setSaveFailed(false); setUnavailable(false); setCookieNotice(null); }, []),
  };
}
