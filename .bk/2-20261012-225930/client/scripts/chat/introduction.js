// Personal introductions are grounded in the published information JSON.
// No guessed job titles, claimed clients, or AI-generated HTML are used here.
let previousPortrait = '';
export function selectIntroPortrait(values, random = Math.random) {
  const options = [...new Set((Array.isArray(values) ? values : []).filter(x => typeof x === 'string' && x.trim()))];
  if (!options.length) return null;
  const eligible = options.length > 1 ? options.filter(x => x !== previousPortrait) : options;
  const index = Math.max(0, Math.min(eligible.length - 1, Math.floor(random() * eligible.length)));
  const selected = eligible[index];
  previousPortrait = selected;
  return selected;
}
export function introductionFromPublished(info = {}, opening = '') {
  const safe = value => String(value || '').replace(/\s+/g, ' ').trim();
  const name = safe(info.name?.full) || 'the portfolio owner';
  const role = safe(info.headline);
  const intro = safe(info.intro);
  const location = safe(info.location);
  const availability = safe(info.availability);
  const count = Number(info.portfolio?.projects?.count);
  const projectText = Number.isFinite(count) && count >= 0
    ? `The portfolio describes **${count} projects** across its wider workspace; only approved examples are published here.` : '';
  return [opening, `## Meet ${name}`, role ? `**Professional background:** ${role}` : '', intro,
    location ? `**Based in:** ${location}` : '', availability ? `**Availability:** ${availability}` : '',
    projectText, 'You can explore the published **projects**, **experience**, **certificates**, and **career profile** below.']
    .filter(Boolean).join('\n\n');
}
export function introductionCardData(info = {}) {
  return {
    name: String(info.name?.full || 'Portfolio owner'),
    role: String(info.headline || 'Portfolio introduction'),
    location: String(info.location || ''),
    availability: String(info.availability || ''),
    description: String(info.intro || '').trim()
  };
}
