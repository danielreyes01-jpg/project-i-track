/* Print preview uses a self-contained document so application styles cannot hide report data. */
(function () {
  'use strict';
  const trigger = document.getElementById('learningReportButton');
  if (!trigger) return;
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const style = document.createElement('style');
  style.textContent = '#learningReportDialog{position:fixed;inset:0;width:min(1200px,96vw);height:92dvh;max-height:92dvh;padding:0;border:1px solid #aac6d0;border-radius:16px;background:#143247;color:#fff;overflow:hidden}#learningReportDialog::backdrop{background:rgba(7,23,35,.8)}#learningReportDialog .report-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px}#learningReportDialog .report-toolbar h2{margin:0;color:#fff!important;font:700 18px Arial}#learningReportDialog .report-buttons{display:flex;gap:8px}#learningReportDialog iframe{display:block;width:100%;height:calc(100% - 78px);border:0;background:#fff}#learningReportDialog .report-help{margin:0;padding:0 18px 10px;color:#d9ebf0;font:12px Arial}@media(max-width:600px){#learningReportDialog .report-toolbar{flex-wrap:wrap}}';
  document.head.appendChild(style);
  const dialog = document.createElement('dialog');
  dialog.id = 'learningReportDialog';
  dialog.setAttribute('aria-labelledby', 'learningReportTitle');
  dialog.innerHTML = '<div class="report-toolbar"><h2 id="learningReportTitle">Learning Resources Report</h2><div class="report-buttons"><button type="button" data-report-close>Close</button><button type="button" data-report-print disabled>Print Report</button></div></div><p class="report-help">Preview the current overview below, then print or save as PDF.</p><iframe title="Learning Resources report preview"></iframe>';
  document.body.appendChild(dialog);
  const frame = dialog.querySelector('iframe');
  const print = dialog.querySelector('[data-report-print]');
  frame.addEventListener('load', () => { print.disabled = false; });
  dialog.querySelector('[data-report-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => trigger.focus());
  print.addEventListener('click', () => { frame.contentWindow.focus(); frame.contentWindow.print(); });
  trigger.addEventListener('click', () => {
    const overview = document.getElementById('adminOverview');
    if (!overview || trigger.disabled) return;
    print.disabled = true;
    const metrics = Array.from(overview.querySelectorAll('.metric')).map(el => '<div class="metric"><span>'+escape(el.querySelector('span').textContent)+'</span><strong>'+escape(el.querySelector('strong').textContent)+'</strong></div>').join('');
    const districts = Array.from(overview.querySelectorAll('.legend-item')).map(el => {
      const counts = el.querySelector('.legend-total').textContent.split('/').map(v => v.trim());
      return '<tr><td>'+escape(el.querySelector('.legend-name').textContent)+'</td>'+counts.map(v => '<td>'+escape(v)+'</td>').join('')+'</tr>';
    }).join('');
    const districtTable = '<section><h2>District Learning Resource Activity</h2><table><thead><tr><th>District</th><th>Assigned</th><th>Ongoing</th><th>Completed</th></tr></thead><tbody>'+(districts || '<tr><td colspan="4">No district activity available.</td></tr>')+'</tbody></table></section>';
    const tables = Array.from(overview.querySelectorAll('.data-card')).map(card => {
      const table = card.querySelector('table').cloneNode(true);
      table.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
      // Keep readable file labels without interactive controls in the printed report.
      table.querySelectorAll('a').forEach(link => link.replaceWith(document.createTextNode(link.textContent)));
      if (card.querySelector('#teacherOverviewBody')) {
        const rows = Array.from(table.tBodies[0].rows).filter(row => row.cells.length === 5);
        const withUploads = rows.filter(row => Number(row.cells[2].textContent.trim()) > 0);
        const zeroUploads = rows.filter(row => Number(row.cells[2].textContent.trim()) === 0);
        withUploads.sort((a, b) => Number(b.cells[2].textContent) - Number(a.cells[2].textContent) || a.cells[0].textContent.localeCompare(b.cells[0].textContent));
        zeroUploads.sort((a, b) => a.cells[0].textContent.localeCompare(b.cells[0].textContent));
        const teacherGroup = (title, group) => '<section><h2>'+title+' ('+group.length+')</h2><table>'+table.tHead.outerHTML+'<tbody>'+(group.map(row => row.outerHTML).join('') || '<tr><td colspan="5">No teachers in this category.</td></tr>')+'</tbody></table></section>';
        return teacherGroup('Teachers with Uploads', withUploads)+teacherGroup('Teachers with Zero Uploads', zeroUploads);
      }
      return '<section><h2>'+escape(card.querySelector('h3').textContent)+'</h2>'+table.outerHTML+'</section>';
    }).join('');
    const generated = new Date().toLocaleString('en-PH');
    frame.srcdoc = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Project I-TRACK Learning Resources Report</title><style>@page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{margin:0;padding:24px;color:#123047;background:#fff;font:13px/1.45 Arial,sans-serif}header{border-bottom:2px solid #197895;padding-bottom:12px;margin-bottom:18px}h1{margin:4px 0;font-size:25px}h2{font-size:17px;margin:20px 0 10px}p{margin:4px 0;color:#526775}.metrics{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:9px}.metric{padding:12px;border:1px solid #cbdde2;border-radius:8px;background:#f3f8fa}.metric span{display:block;font-size:11px}.metric strong{display:block;font-size:24px;margin-top:4px}table{border-collapse:collapse;width:100%;table-layout:fixed;margin-bottom:15px}th,td{border:1px solid #ccdce1;padding:7px;text-align:left;vertical-align:top;overflow-wrap:anywhere;font-size:11px}th{background:#e9f2f5}thead{display:table-header-group}tr{break-inside:avoid}h2{break-after:avoid}header,.metrics{break-inside:avoid}.small-status{font-weight:bold}section{margin-top:18px}@media(max-width:650px){.metrics{grid-template-columns:repeat(3,1fr)}}@media print{body{padding:0}.metrics{grid-template-columns:repeat(6,1fr)}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body><header><p>PROJECT I-TRACK · Schools Division of Cebu Province</p><h1>Learning Resources Report</h1><p>Administrator overview · All overview data · Generated '+escape(generated)+'</p><p>Confidential — for authorized educational use.</p></header><div class="metrics">'+metrics+'</div>'+districtTable+tables+'</body></html>';
    dialog.showModal();
  });
})();
