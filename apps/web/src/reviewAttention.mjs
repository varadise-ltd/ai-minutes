export function issuesForMinutesItem(validation = [], itemNumber) {
  const prefix = new RegExp(`^Item ${itemNumber}(?::|\\s|$)`);
  return validation
    .filter(issue => prefix.test(issue))
    .map(issue => issue.replace(new RegExp(`^Item ${itemNumber}(?::\\s*|\\s*)`), ''));
}

export function minutesItemsWithAttention(items = [], validation = []) {
  return items.map((item, index) => ({
    item,
    index,
    number: index + 1,
    issues: issuesForMinutesItem(validation, index + 1)
  }));
}
