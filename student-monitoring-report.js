(function () {
  'use strict';
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const hero = document.querySelector('.shell .hero');
  if (!hero) return;
  const button = document.createElement('button');
  button.type = 'button'; button.textContent = '▤ View Report';
  button.style.cssText = 'margin-top:14px;position:relative;z-index:1';
  hero.appendChild(button);
  const dialog = document.createElement('dialog');
  dialog.id = 'studentMonitoringReport';
  dialog.setAttribute('aria-labelledby', 'studentReportTitle');
  dialog.innerHTML = '<header><h2 id="studentReportTitle">Student Monitoring Report</h2><div><button type="button" data-close>Close</button> <button type="button" data-print disabled>Print Report</button></div></header><p data-state role="status">Loading report…</p><iframe title="Student monitoring report preview" hidden></iframe>';
  document.body.appendChild(dialog);
  const style = document.createElement('style');
  style.textContent = '#studentMonitoringReport{position:fixed;inset:0;width:min(1200px,96vw);height:92dvh;max-height:92dvh;padding:0;border:1px solid #aac6d0;border-radius:16px;background:#143247;color:#fff;overflow:hidden}#studentMonitoringReport::backdrop{background:rgba(7,23,35,.8)}#studentMonitoringReport>header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding:14px 18px}#studentMonitoringReport h2{margin:0;color:#fff!important;font:700 18px Arial}#studentMonitoringReport [data-state]{padding:8px 18px;color:#fff!important}#studentMonitoringReport iframe{display:block;width:100%;height:calc(100% - 82px);border:0;background:#fff}#studentMonitoringReport iframe[hidden]{display:none}';
  document.head.appendChild(style);
  const frame = dialog.querySelector('iframe'), print = dialog.querySelector('[data-print]'), state = dialog.querySelector('[data-state]');
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => button.focus());
  frame.addEventListener('load', () => { if (!frame.hidden) print.disabled = false; });
  print.addEventListener('click', () => { frame.contentWindow.focus(); frame.contentWindow.print(); });
  button.addEventListener('click', async () => {
    const term = document.querySelector('#modularTermFilter button.active')?.dataset.term || 'all';
    const termLabel = term === 'all' ? 'All Terms' : 'Term '+term;
    button.disabled = true; print.disabled = true; frame.hidden = true;
    state.hidden = false; state.textContent = 'Loading '+termLabel+' report…'; dialog.showModal();
    try {
      const response = await fetch('/api/admin/modular-tracking-summary', {credentials:'include', cache:'no-store'});
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to load report.');
      const summary = term === 'all' ? data.all || {} : (data.terms || {})[term] || {};
      const students = Array.isArray(data.students) ? data.students : [];
      const metrics = [['Total Modules','total'],['Assigned','assigned'],['Ongoing','ongoing'],['Completed','completed'],['Active Students','participating'],['Need Follow-up','needsFollowUp']].map(([label,key]) => '<div><span>'+label+'</span><strong>'+Number(summary[key] || 0)+'</strong></div>').join('');
      const rows = students.map(student => {
        const s = term === 'all' ? student.all || {} : (student.terms || {})[term] || {};
        return '<tr><td>'+escape(student.name)+'</td><td>'+escape(student.lrn || '—')+'</td><td>'+escape(student.school || '—')+'</td>'+['total','assigned','ongoing','completed'].map(key => '<td>'+Number(s[key] || 0)+'</td>').join('')+'<td>'+Number(s.completionRate || 0).toFixed(1)+'%</td></tr>';
      }).join('');
      const activities = students.flatMap(student => (student.activities || []).filter(entry => term === 'all' || String(entry.term) === term).map(entry => '<tr><td>'+escape(student.name)+'</td><td>Term '+escape(entry.term)+'</td><td>'+escape(entry.moduleNumber)+'</td><td>'+escape(entry.title)+'</td><td>'+escape(entry.status === 'done' ? 'Completed' : entry.status === 'ongoing' ? 'Ongoing' : 'Assigned')+'</td></tr>')).join('');
      frame.srcdoc = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Student Monitoring Report</title><style>@page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{padding:24px;margin:0;font:12px/1.45 Arial;color:#123047}h1{font-size:24px;margin:4px 0}h2{font-size:17px;break-after:avoid}header{border-bottom:2px solid #197895;margin-bottom:16px}p{color:#526775}.metrics{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;break-inside:avoid}.metrics>div{padding:12px;border:1px solid #ccdce1;background:#f1f8fa}.metrics span{display:block;font-size:10px}.metrics strong{display:block;font-size:23px}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #ccdce1;padding:7px;text-align:left;overflow-wrap:anywhere;vertical-align:top;font-size:11px}th{background:#e9f2f5}thead{display:table-header-group}tr{break-inside:avoid}@media print{body{padding:0}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body><header><p>PROJECT I-TRACK · Schools Division of Cebu Province</p><h1>Student Monitoring Report</h1><p>'+escape(termLabel)+' · Generated '+escape(new Date().toLocaleString('en-PH'))+'</p><p>Confidential — for authorized educational use.</p></header><div class="metrics">'+metrics+'</div><p>'+Number(summary.completionRate || 0).toFixed(1)+'% module completion</p><h2>Learner Progress</h2><table><thead><tr><th>Learner</th><th>LRN</th><th>School</th><th>Total</th><th>Assigned</th><th>Ongoing</th><th>Completed</th><th>Completion</th></tr></thead><tbody>'+(rows || '<tr><td colspan="8">No learner records available.</td></tr>')+'</tbody></table><h2>Learning Activity Details</h2><table><thead><tr><th>Learner</th><th>Term</th><th>Module No.</th><th>Title</th><th>Status</th></tr></thead><tbody>'+(activities || '<tr><td colspan="5">No learning activity for the selected term.</td></tr>')+'</tbody></table></body></html>';
      state.hidden = true; frame.hidden = false;
    } catch (error) { state.textContent = (error.message || 'Unable to load report.')+' Close the preview and try again.'; }
    finally { button.disabled = false; }
  });
})();
