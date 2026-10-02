import React, { useEffect, useRef } from 'react';
import { CalendarBlank, CheckCircle, Clock, WarningCircle, LinkBreak, VideoCamera, UploadSimple, X } from '@phosphor-icons/react';
import { labels } from './api';
export function Status({
  value
}) {
  const Icon = {
    READY_FOR_REVIEW: CheckCircle,
    APPROVED: CheckCircle,
    WAITING_FOR_ADMISSION: Clock,
    SCHEDULED: CalendarBlank,
    SETUP_REQUIRED: WarningCircle,
    FAILED: WarningCircle,
    DRAFT: LinkBreak
  }[value] || Clock;
  return <span className={'status status-' + value}><Icon size={18} weight={['READY_FOR_REVIEW', 'APPROVED'].includes(value) ? 'fill' : 'regular'} />{labels[value] || value}</span>;
}
export function Platform({
  value
}) {
  return <span className={'platform ' + value.toLowerCase()}>{value === 'Upload' ? <UploadSimple size={21} /> : <VideoCamera size={21} weight='fill' />}{value}</span>;
}
export function Empty({
  title = 'Nothing here yet',
  text = 'Your meetings will appear here.',
  children
}) {
  return <div className='empty'><CalendarBlank size={38} /><h3>{title}</h3><p>{text}</p>{children}</div>;
}
export function Button({
  icon: Icon,
  children,
  primary = false,
  ...props
}) {
  return <button className={primary ? 'button primary' : 'button'} {...props}>{Icon && <Icon size={18} />} {children}</button>;
}
export function Modal({
  title,
  children,
  onClose,
  wide = false
}) {
  const ref = useRef();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus();
    const handler = e => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab') {
        const els = Array.from(ref.current?.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]') || []).filter(el => !el.disabled);
        if (e.shiftKey && document.activeElement === els[0]) {
          e.preventDefault();
          els.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === els.at(-1)) {
          e.preventDefault();
          els[0]?.focus();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      previous?.focus();
    };
  }, []);
  return <div className='overlay' onClick={e => e.target === e.currentTarget && onClose()}><section className={'modal ' + (wide ? 'wide' : '')} role='dialog' aria-modal='true' aria-labelledby='modal-title' tabIndex={-1} ref={ref}><header><h2 id='modal-title'>{title}</h2><button className='icon-button' onClick={onClose} aria-label='Close dialog'><X size={22} /></button></header>{children}</section></div>;
}
export function Field({
  label,
  children,
  hint
}) {
  return <label className='field'><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
