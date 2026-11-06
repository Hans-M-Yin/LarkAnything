import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, MoreHorizontal } from 'lucide-react';
import { shortcutLabel, shortcutAria } from './useShortcuts';

type Source = { id: string; label: string; icon: string };
export function SourceSwitcher({ sources, selected, disabled, onSelect }: {
  sources: Source[]; selected: string; disabled: boolean; onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const overflow = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const count = sources.length;
  const circular = count > 3;
  const [rail, setRail] = useState({ position: circular ? count : 0, animate: true });
  const previous = useRef(selected);
  const track = useRef<HTMLDivElement>(null);
  const slots = circular ? [...sources, ...sources, ...sources] : sources;
  // Keep the chosen source in the middle. Selecting the right neighbour moves
  // exactly one slot left; selecting the left neighbour reverses the motion.
  useLayoutEffect(() => {
    if (previous.current === selected) return;
    previous.current = selected;
    const index = sources.findIndex(s => s.id === selected);
    if (!circular || index < 0) return;
    setRail(current => {
      const centre = current.position + 1;
      let delta = ((index - centre) % count + count) % count;
      if (delta > count / 2) delta -= count;
      return { position: current.position + delta, animate: true };
    });
  }, [selected, count, circular, sources]);
  // Rebase identical copies outside the viewport after motion settles. This
  // makes the end wrap to the beginning without a visible jump or a long rewind.
  useEffect(() => {
    if (!circular || !rail.animate) return;
    const timer = setTimeout(() => {
      const position = count + ((rail.position % count) + count) % count;
      if (position === rail.position) return;
      const focused = track.current?.contains(document.activeElement)
        ? (document.activeElement as HTMLElement)?.dataset.source : undefined;
      setRail({ position, animate: false });
      if (focused) requestAnimationFrame(() => track.current?.querySelector<HTMLButtonElement>(`button[data-source="${focused}"]:not([aria-hidden="true"])`)?.focus({ preventScroll: true }));
    }, 360);
    return () => clearTimeout(timer);
  }, [rail, circular, count]);
  useLayoutEffect(() => {
    if (rail.animate) return;
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setRail(current => ({ ...current, animate: true }))); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [rail.animate]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!overflow.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return <nav className="sources animated-sources" aria-label="内容来源">
    <div className="source-viewport">
      <div ref={track} className="source-track" style={{ '--source-offset': rail.position, '--source-slots': Math.min(3, count), transition: rail.animate ? undefined : 'none' } as React.CSSProperties}>
      {slots.map((source, slot) => {
        const visible = slot >= rail.position && slot < rail.position + 3;
        return <button key={`${slot}-${source.id}`} data-source={source.id} disabled={disabled} tabIndex={visible ? 0 : -1} aria-hidden={visible ? undefined : true}
          title={`${source.label}${sources.indexOf(source) < 3 ? `（${shortcutLabel(String(sources.indexOf(source) + 1))}）` : ""}`} aria-keyshortcuts={visible && sources.indexOf(source) < 3 ? shortcutAria(String(sources.indexOf(source) + 1)) : undefined} aria-label={source.label}
          aria-pressed={selected === source.id} className={`source ${selected === source.id ? 'active' : ''}`} onClick={() => onSelect(source.id)}>
          <img className={['codex','opencode','notion'].includes(source.id) ? 'mono' : ''} src={`./assets/${source.icon}`} alt=""/>
          <span className="source-label" aria-hidden="true">{source.label}</span>
        </button>;
      })}
      </div>
    </div>
    {circular && <div className="source-overflow" ref={overflow}>
      <button ref={trigger} className="more-sources" disabled={disabled} title="更多来源" aria-label="更多来源" aria-expanded={open} aria-controls="more-source-list" onClick={() => setOpen(value => !value)}><MoreHorizontal size={19}/></button>
      {open && <div id="more-source-list" className="source-picker" role="group" aria-label="选择更多来源">
        <small>全部来源</small>
        {sources.map(source => <button key={source.id} aria-pressed={selected === source.id} onClick={() => { onSelect(source.id); setOpen(false); trigger.current?.focus(); }}>
          <img className={['codex','opencode','notion'].includes(source.id) ? 'mono' : ''} src={`./assets/${source.icon}`} alt=""/><span>{source.label}</span>{selected === source.id && <Check size={14}/>}
        </button>)}
      </div>}
    </div>}
  </nav>;
}
