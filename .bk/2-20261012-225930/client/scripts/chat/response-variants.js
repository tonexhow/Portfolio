// Portfolio facts remain verbatim. Only the surrounding phrasing is randomized.
// Eight options per intent, with immediate repetitions avoided for a session.
const OPENINGS = Object.freeze({
  welcome: [
    "Hello! I'm **Tonex Bot**. What would you like to explore?",
    "Welcome! I can help you navigate the portfolio. Where shall we begin?",
    "Hi there! Looking for projects, experience, or contact information?",
    "Thanks for visiting! Tell me what you'd like to know about the portfolio.",
    "Hey! I can guide you through the work and professional background here.",
    "Good to see you! Need a project example or details about the developer?",
    "Welcome to JPano. I'm Tonex Bot—your guide to this portfolio.",
    "Hello and welcome! Ask me about any of the published portfolio sections."
  ],
  intro: [
    "Here's a quick introduction.", "Happy to introduce the developer behind this portfolio.",
    "Of course—let me share his published background.", "Here's who this portfolio represents.",
    "Let's start with an introduction.", "I'd be glad to tell you about him.",
    "Here's a short overview of the person behind JPano.", "Sure! Here's his professional introduction."
  ],
  career: [
    "You can review the published career documents below.", "Here are the professional documents currently available.",
    "I found these career-profile records.", "These documents might be useful for assessing his background.",
    "Let's look at the published résumé and related documents.", "Here are the available career-profile materials.",
    "These published documents outline his professional background.", "This is what's publicly available under Career Profile."
  ],
  skills: [
    "Here's an overview of the published technical skills.", "These are the technologies listed on the portfolio.",
    "Let's take a look at the documented skills.", "The portfolio lists the following capabilities.",
    "You can explore his technical background here.", "Here are the skills currently published on the website.",
    "The available skill set is organized below.", "Here's the published technology overview."
  ],
  experience: [
    "These are the professional experiences shown in the portfolio.", "Let's look at the published work history.",
    "Here's the experience on record, without guessing about private work.", "The portfolio lists these previous and current roles.",
    "I found these documented experiences.", "Here is a factual overview of his professional background.",
    "The published work-history entries are below.", "Let's review the relevant experience he has shared."
  ],
  contact: [
    "Here's how to get in touch.", "I'd be happy to point you to his contact details.",
    "You can reach him using the published contacts below.", "Interested in collaborating? Here are the official contact options.",
    "Let's connect you with the developer.", "These are the contact details listed on the portfolio.",
    "Here are your options for reaching out.", "For an inquiry, these published details are a good starting point."
  ],
  certificates: [
    "Here are the publicly listed certificates.", "Let's explore the available credentials.",
    "These certifications and awards are published on the site.", "You can review his documented certificates here.",
    "I found the following certificate information.", "Here is the currently published certificate collection.",
    "Want to check training records? Start with these certificates.", "The certificate gallery contains the following records."
  ],
  projects: [
    "Here are some relevant published projects.", "Let's look at the work currently shown on JPano.",
    "These project examples may help you evaluate his experience.", "I found these published projects for you.",
    "Here's a selection from the public project portfolio.", "Let's explore the implemented systems and their descriptions.",
    "These are the public examples I can share.", "Consider these published project references."
  ],
  general: [
    "I can help you find information across this portfolio.", "What aspect of the developer's work interests you?",
    "Tell me what you'd like to explore, and I'll point you to the right section.",
    "Looking for something particular? I can search the published portfolio.",
    "I can guide you to projects, skills, experience, certificates, or contact details.",
    "Ask me about a technology, work history, or a published project.",
    "I'm here to help you discover what's published on JPano.",
    "Need a specific example or document? Tell me what you're interested in."
  ]
});
const last = new Map();
export function variation(topic) {
  const choices = OPENINGS[topic] || OPENINGS.general;
  const previous = last.get(topic) ?? -1;
  const index = choices.length < 2 ? 0 : (() => {
    const candidate = Math.floor(Math.random() * (choices.length - 1));
    return candidate >= previous ? candidate + 1 : candidate;
  })();
  last.set(topic, index);
  return choices[index];
}
export function variantCount(topic) { return (OPENINGS[topic] || []).length; }
