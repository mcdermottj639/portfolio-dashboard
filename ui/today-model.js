/* Pure Today presentation helpers. Existing account/strategy models stay authoritative. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./experience-model.js'));
  else root.PFTodayModel = factory(root.PFExperienceModel);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M) {
  'use strict';
  const number = M.number;
  const list = value => Array.isArray(value) ? value : [];

  function holdings(brief) {
    return list(brief?.positions).map(row => {
      const sources = list(row?.sources);
      let prior = 0, day = 0;
      let complete = sources.length > 0 && row?.partialDay !== true;
      for (const source of sources) {
        const qty = number(source?.qty), px = number(source?.px), move = number(source?.day);
        if (!(qty > 0 && px > 0) || move === null || !Number.isFinite(qty * px)) {
          complete = false;
          break;
        }
        prior += qty * px - move;
        day += move;
      }
      const changePct = complete && prior > 0 && Number.isFinite(prior) && Number.isFinite(day)
        && Number.isFinite(day / prior * 100) ? day / prior * 100 : null;
      return {...row, changePct};
    });
  }

  function treemap(rows, width = 640, height = 260) {
    const W = number(width), H = number(height);
    if (!(W > 0 && H > 0)) return [];
    const items = list(rows).flatMap((row, order) => {
      const value = number(row?.value);
      return value > 0 ? [{row, value, order}] : [];
    }).sort((a, b) => b.value - a.value || a.order - b.order);
    if (!items.length) return [];
    // Scaling avoids overflow when adding otherwise finite positive values.
    const max = items[0].value;
    items.forEach(item => { item.weight = item.value / max; });
    const total = items.reduce((sum, item) => sum + item.weight, 0), output = [];
    function split(group, x, y, w, h) {
      if (group.length === 1) {
        const item = group[0];
        output.push({...item.row, x:x / W * 100, y:y / H * 100, w:w / W * 100,
          h:h / H * 100, share:item.weight / total * 100});
        return;
      }
      const weight = group.reduce((sum, item) => sum + item.weight, 0);
      let sum = 0, best = Infinity, cut = 1, leftWeight = group[0].weight;
      for (let i = 0; i < group.length - 1; i++) {
        sum += group[i].weight;
        const distance = Math.abs(weight / 2 - sum);
        if (distance < best) { best = distance; cut = i + 1; leftWeight = sum; }
      }
      const ratio = weight > 0 ? leftWeight / weight : cut / group.length;
      const first = group.slice(0, cut), second = group.slice(cut);
      if (w >= h) {
        const firstWidth = w * ratio;
        split(first, x, y, firstWidth, h);
        split(second, x + firstWidth, y, w - firstWidth, h);
      } else {
        const firstHeight = h * ratio;
        split(first, x, y, w, firstHeight);
        split(second, x, y + firstHeight, w, h - firstHeight);
      }
    }
    split(items, 0, 0, W, H);
    return output;
  }

  function ticket(pending) {
    const result = (group, label, detail, tone = 'neutral') => ({group, label, detail, tone});
    if (!pending || typeof pending !== 'object' || Array.isArray(pending)
      || !Object.values(pending).some(value => value !== null && value !== undefined && value !== '')) {
      return result('none', '', '');
    }
    const status = typeof pending.status === 'string' ? pending.status.trim().toLowerCase() : '';
    if (status === 'proposed') {
      return pending.autoEligible === true
        ? result('monitor', 'Queued for executor', 'Automatically eligible proposal. Broker submission has not been confirmed.')
        : result('waiting', 'Awaiting your confirmation', 'Proposed ticket. Review the full plan before confirming.', 'warn');
    }
    if (status === 'confirmed') return result('monitor', 'Queued for executor', 'Confirmation is recorded. Broker submission has not been confirmed.');
    if (status === 'sells-placed' || status === 'buys-placed') return result('monitor', 'Submission reported', 'The recorded ticket reports submitted orders. Fill status is not confirmed.');
    if (status === 'partial-fill' || status === 'partially-filled') return result('monitor', 'Partial fill reported', 'The recorded ticket reports a partial fill. Check the remaining quantity and latest broker status.', 'warn');
    if (status === 'done') return result('complete', 'Recorded ticket complete', 'The ticket is marked complete. This does not independently confirm broker fills.');
    if (status === 'cancelled') return result('complete', 'Ticket cancelled', 'Cancellation is recorded. Broker cancellation status is not independently verified.');
    if (status === 'aborted' || status === 'rejected') return result('waiting', 'Ticket needs review', 'The recorded ticket was ' + status + '. Review the reason and any remaining order status.', 'warn');
    return result('waiting', 'Status needs review', 'The recorded ticket status is unrecognized. Open Activity to verify the next step.', 'warn');
  }

  function levels(value) {
    const stop = number(value?.stop), entry = number(value?.limit), target = number(value?.tp1);
    if (!(stop > 0 && entry > stop && target > entry)) return null;
    const entryPct = (entry - stop) / (target - stop) * 100;
    return Number.isFinite(entryPct) ? {stop, entry, target, entryPct} : null;
  }

  function biggestDrag(rows) {
    let worst = null, move = 0;
    for (const row of list(rows)) {
      const day = number(row?.day);
      if (row?.partialDay === false && day !== null && day < move) { worst = row; move = day; }
    }
    return worst;
  }

  return {holdings, treemap, ticket, levels, biggestDrag};
});
