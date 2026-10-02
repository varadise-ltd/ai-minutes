import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import Decimal from 'decimal.js';
export const ROLES = ['ORG_ADMIN','MEETING_ORGANIZER','REVIEWER','APPROVER','MEMBER'];
export function hashPassword(password) { const salt=randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password,salt,64).toString('hex')}`; }
export function checkPassword(password,hash) { if(!hash) return false; const [salt,key]=hash.split(':'); const value=scryptSync(password,salt,64); return key?.length===128 && timingSafeEqual(value,Buffer.from(key,'hex')); }
export function can(user,...roles) { return user.roles.includes('ORG_ADMIN') || roles.some(r=>user.roles.includes(r)); }
export function canRead(user,meeting) { return user.org_id===meeting.org_id && (can(user,'ORG_ADMIN') || meeting.owner_id===user.id || meeting.reviewer_id===user.id || user.unit_ids.includes(meeting.unit_id)); }
export function cost(quantity,rate,fx) { const usd=new Decimal(quantity).times(rate); return {usd:usd.toFixed(8),hkd:usd.times(fx).toFixed(8)}; }
export function meetingPlatform(link) {
  let url; try { url=new URL(link); } catch { throw new Error('Enter a valid Teams or Zoom meeting link.'); }
  if(url.protocol!=='https:' || url.username || url.password) throw new Error('Use an HTTPS meeting link without credentials.');
  if(['teams.microsoft.com','teams.live.com','teams.cloud.microsoft'].includes(url.hostname)) return 'Teams';
  if(url.hostname==='zoom.us'||url.hostname.endsWith('.zoom.us')) return 'Zoom';
  throw new Error('Only Microsoft Teams and Zoom meeting links are supported.');
}
export function validateEvidence(content,segments) {
  const issues=[]; const byId=new Map(segments.map(s=>[s.id,s]));
  for(const [index,item] of (content.items||[]).entries()) {
    if(!item.text?.trim()) {issues.push(`Item ${index+1} is empty.`); continue;}
    if(['decision','action'].includes(item.type)) {
      const segment=byId.get(item.evidence);
      if(!segment) issues.push(`Item ${index+1}: link an existing transcript segment.`);
      else {
        if(!item.quote || !segment.text.includes(item.quote)) issues.push(`Item ${index+1}: the source quote must match its transcript.`);
        if(item.owner && !segment.text.toLowerCase().includes(item.owner.toLowerCase())) issues.push(`Item ${index+1}: the owner is not named in the source quote.`);
        if(item.dueDate && !segment.text.includes(item.dueDate)) issues.push(`Item ${index+1}: the deadline is not stated in the source (YYYY-MM-DD).`);
      }
      if(!item.verified) issues.push(`Item ${index+1}: a reviewer must verify the claim against the source.`);
    }
  }
  return issues;
}
export function nextState(current,action) {
  const transitions={submit:{READY_FOR_REVIEW:'IN_REVIEW',REJECTED:'IN_REVIEW'},approve:{IN_REVIEW:'APPROVED'},reject:{IN_REVIEW:'REJECTED'},reopen:{APPROVED:'READY_FOR_REVIEW'},cancel:{DRAFT:'CANCELLED',SCHEDULED:'CANCELLED',SETUP_REQUIRED:'CANCELLED',WAITING_FOR_ADMISSION:'CANCELLED'}};
  const state=transitions[action]?.[current]; if(!state) throw new Error(`Cannot ${action} while ${current.toLowerCase().replaceAll('_',' ')}.`); return state;
}
