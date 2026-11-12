import type { AmountRule } from './types';
import { money } from './format';
import { monthShort } from './month';

/** Opis reguły planu w jednym zdaniu. */
export const describeRule = (r: AmountRule) => {
  const what = r.pattern
    ? `schemat roczny (${r.pattern.filter((v) => v !== 0).length} płatności w roku, razem ${money(r.pattern.reduce((a, b) => a + b, 0))})`
    : `${money(r.amount)}${r.everyMonths && r.everyMonths > 1 ? ` co ${r.everyMonths} mies.` : ' co miesiąc'}`;
  return `od ${monthShort(r.from)}: ${what}${r.indexation ? `, +${r.indexation}% co rok` : ''}${r.until ? `, do ${monthShort(r.until)}` : ''}`;
};

