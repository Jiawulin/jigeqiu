import { useEffect, useRef, useState, type RefObject } from 'react';
import { advanceLaunchpadInertia, createLaunchpadDrag, launchpadLetterAt } from './launchpad-gestures';
import { traceLaunchpadGesture as trace } from './launchpad-gesture-debug';

export function useLaunchpadGestures(
  root: RefObject<HTMLDivElement | null>, scroll: RefObject<HTMLDivElement | null>,
  enabled: boolean, query: string, onLetter: (letter: string, finished?: boolean) => boolean,
  menuOpen: boolean,
) {
  const [preview, setPreview] = useState<{ letter: string; top: number } | null>(null);
  const letterCallback = useRef(onLetter);
  const interrupt = useRef<(() => void) | null>(null);
  letterCallback.current = onLetter;
  useEffect(() => {
    if (menuOpen) interrupt.current?.();
  }, [menuOpen]);
  useEffect(() => {
    const shell = root.current;
    const container = scroll.current;
    if (!enabled || !shell || !container) { setPreview(null); return; }
    let frame = 0;
    let lastScroll = -Infinity;
    let blockedClick = false;
    let pointer: {
      id: number; type: string; top: number;
      drag: ReturnType<typeof createLaunchpadDrag>; alphabet: HTMLElement | null; letter: string | null;
    } | null = null;
    const stopInertia = () => { cancelAnimationFrame(frame); frame = 0; };
    const flushDrag = () => {
      if (pointer?.type === 'mouse' && !pointer.alphabet && pointer.drag.dragging) {
        stopInertia();
        container.scrollTop = pointer.top;
      }
    };
    const release = () => {
      const active = pointer;
      pointer = null;
      if (active) {
        active.drag.cancel();
        if (shell.hasPointerCapture(active.id)) shell.releasePointerCapture(active.id);
      }
      container.removeAttribute('data-dragging');
      setPreview(null);
    };
    const cancel = () => {
      flushDrag();
      stopInertia();
      if (pointer) blockedClick = true;
      release();
    };
    const cancelled = (reason: 'menu' | 'wheel' | 'key' | 'blur' | 'pointercancel' | 'lostpointercapture' | 'cleanup' | 'additional-pointer') => {
      trace('cancel', { reason, top: container.scrollTop, dragging: pointer?.drag.dragging });
      cancel();
    };
    interrupt.current = () => cancelled('menu');
    const locate = (nav: HTMLElement, y: number) => {
      const cells = [...nav.querySelectorAll<HTMLElement>('[data-launchpad-letter]')].map(element => {
        const rect = element.getBoundingClientRect();
        return { letter: element.dataset.launchpadLetter!, center: rect.top + rect.height / 2 };
      });
      const letter = launchpadLetterAt(y, cells);
      if (letter && letterCallback.current(letter)) {
        if (pointer) pointer.letter = letter;
        setPreview({ letter, top: Math.max(64, Math.min(innerHeight - 64, y)) });
      }
    };
    const down = (event: PointerEvent) => {
      trace('down', { x: event.clientX, y: event.clientY, buttons: event.buttons,
        mouse: event.pointerType === 'mouse', top: container.scrollTop,
        delay: performance.now() - event.timeStamp }, event.timeStamp);
      const wasMoving = frame !== 0 || (event.pointerType === 'touch' && performance.now() - lastScroll < 120);
      stopInertia();
      if (pointer) { cancelled('additional-pointer'); return; }
      if (!event.isPrimary) return;
      if (event.button !== 0) { blockedClick = false; return; }
      blockedClick = false;
      const target = event.target instanceof Element ? event.target : null;
      const alphabet = target?.closest<HTMLElement>('[data-launchpad-alphabet]') ?? null;
      if (!target || (!alphabet && (!container.contains(target)
        || target.closest('.launchpad-more,input,select,textarea,a,[role="menu"],[role="alertdialog"]')))) return;
      // Let the browser own its native scrollbar.
      const rect = container.getBoundingClientRect();
      const scrollbarWidth = Math.max(container.offsetWidth - container.clientWidth, 12);
      if (!alphabet && target === container && container.scrollHeight > container.clientHeight
        && event.clientX >= rect.right - scrollbarWidth) return;
      blockedClick = wasMoving;
      pointer = {
        id: event.pointerId, type: event.pointerType,
        top: container.scrollTop, drag: createLaunchpadDrag(event.clientX, event.clientY, event.timeStamp), alphabet, letter: null,
      };
      if (alphabet) {
        event.preventDefault();
        blockedClick = true;
        shell.setPointerCapture(event.pointerId);
        locate(alphabet, event.clientY);
      } else if (event.pointerType === 'mouse') {
        // Avoid native image dragging and focus-driven scroll jumps during a mouse stroke.
        event.preventDefault();
      }
    };
    const move = (event: PointerEvent, samplePosition = true) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      if (pointer.alphabet) { locate(pointer.alphabet, event.clientY); return; }
      const active = pointer;
      const max = Math.max(0, container.scrollHeight - container.clientHeight);
      const record = (sample: PointerEvent) => {
        active.drag.move(sample.clientX, sample.clientY, sample.timeStamp, samplePosition);
        // Clamp each delta so reversing at an edge responds immediately.
        if (active.type === 'mouse') active.top = active.drag.scrollPosition(active.top, max);
      };
      const samples = event.getCoalescedEvents?.() ?? [];
      for (const sample of samples) record(sample);
      record(event);
      trace('move', { x: event.clientX, y: event.clientY, buttons: event.buttons,
        top: active.top, max, dragging: active.drag.dragging,
        velocity: active.drag.velocity(event.timeStamp), captured: shell.hasPointerCapture(event.pointerId),
        delay: performance.now() - event.timeStamp }, event.timeStamp);
      if (!pointer.drag.dragging) return;
      blockedClick = true;
      if (pointer.type === 'mouse') {
        event.preventDefault();
        if (!shell.hasPointerCapture(event.pointerId)) shell.setPointerCapture(event.pointerId);
        container.setAttribute('data-dragging', 'true');
        if (!frame) frame = requestAnimationFrame(() => {
          frame = 0;
          if (pointer) container.scrollTop = pointer.top;
        });
      }
    };
    const inertia = (velocity: number) => {
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      trace('inertia', { velocity, reduced, top: container.scrollTop });
      if (reduced) return;
      let last = performance.now();
      let position = container.scrollTop;
      const tick = (now: number) => {
        const next = advanceLaunchpadInertia(position, velocity, now - last,
          Math.max(0, container.scrollHeight - container.clientHeight));
        container.scrollTop = next.position;
        position = next.position;
        velocity = next.velocity;
        last = now;
        frame = velocity ? requestAnimationFrame(tick) : 0;
        if (!velocity) trace('end', { top: position, velocity });
      };
      if (Math.abs(velocity) >= 0.05) frame = requestAnimationFrame(tick);
    };
    const up = (event: PointerEvent) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      move(event, false);
      flushDrag();
      const velocity = pointer.type === 'mouse' && !pointer.alphabet ? pointer.drag.releaseVelocity(event.timeStamp) : 0;
      trace('release', { velocity, dragging: pointer.drag.dragging, top: container.scrollTop,
        buttons: event.buttons, mouse: pointer.type === 'mouse',
        delay: performance.now() - event.timeStamp }, event.timeStamp);
      if (pointer.alphabet && pointer.letter) letterCallback.current(pointer.letter, true);
      release();
      inertia(velocity);
    };
    const suppress = (event: MouseEvent) => {
      if (blockedClick && event.detail !== 0) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    const lost = (event: PointerEvent) => {
      if (pointer?.id === event.pointerId) cancelled(event.type === 'pointercancel' ? 'pointercancel' : 'lostpointercapture');
    };
    const key = () => { cancelled('key'); };
    const wheel = () => { cancelled('wheel'); };
    const blur = () => { cancelled('blur'); };
    const dragstart = (event: DragEvent) => { if (pointer) event.preventDefault(); };
    const scrolled = () => {
      lastScroll = performance.now();
      trace('scroll', { top: container.scrollTop });
    };
    const contextmenu = (event: MouseEvent) => {
      if (blockedClick) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    shell.addEventListener('pointerdown', down, true);
    container.addEventListener('scroll', scrolled, { passive: true });
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', lost);
    shell.addEventListener('lostpointercapture', lost);
    shell.addEventListener('click', suppress, true);
    shell.addEventListener('contextmenu', contextmenu, true);
    shell.addEventListener('dragstart', dragstart);
    shell.addEventListener('wheel', wheel, { passive: true });
    document.addEventListener('keydown', key, true);
    window.addEventListener('blur', blur);
    return () => {
      cancelled('cleanup');
      interrupt.current = null;
      shell.removeEventListener('pointerdown', down, true);
      container.removeEventListener('scroll', scrolled);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', lost);
      shell.removeEventListener('lostpointercapture', lost);
      shell.removeEventListener('click', suppress, true);
      shell.removeEventListener('contextmenu', contextmenu, true);
      shell.removeEventListener('dragstart', dragstart);
      shell.removeEventListener('wheel', wheel);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', blur);
    };
  }, [enabled, query, root, scroll]);
  return preview;
}
