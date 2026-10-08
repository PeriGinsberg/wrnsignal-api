// lib/resumeWorkshop/model.ts
//
// The Resume Workshop's vocabulary, shared by the server and the screen: the
// nine discovery tabs and each tab's Coach's Exploration Guide.
//
// The guides are prompts for a conversation, not a questionnaire, and they
// make no assessment claims: what the coach hears is recorded as notes, never
// as a validated finding of any kind (SIGNAL DNA included).

export const TABS = [
  "education", "coursework", "honors", "certifications", "experience",
  "projects", "skills", "leadership", "other",
] as const
export type WorkshopTab = (typeof TABS)[number]

export const TAB_LABEL: Record<WorkshopTab, string> = {
  education: "Education",
  coursework: "Relevant Coursework",
  honors: "Honors / Awards",
  certifications: "Certifications",
  experience: "Work Experience",
  projects: "Academic Projects",
  skills: "Skills",
  leadership: "Leadership / Involvement",
  other: "Other Discoveries",
}

/** A new entry's title placeholder, so the coach knows what the title is for. */
export const TITLE_PLACEHOLDER: Record<WorkshopTab, string> = {
  education: "School, degree, dates",
  coursework: "Course name",
  honors: "Honor or award",
  certifications: "Certification",
  experience: "Organization, role, dates",
  projects: "Project name",
  skills: "Skill area",
  leadership: "Organization, role",
  other: "What you discovered",
}

export function isWorkshopTab(v: unknown): v is WorkshopTab {
  return typeof v === "string" && (TABS as readonly string[]).includes(v)
}

export type GuideSection = { heading: string; prompts: string[] }
export type Guide = { intro: string; sections: GuideSection[]; reminders: string[] }

// The discovery sequence for anything the client did: context, contribution,
// results and evidence, reactions, then follow-up where the answer was thin.
const EXPERIENCE_SEQUENCE: GuideSection[] = [
  {
    heading: "1. Organization and team context",
    prompts: [
      "What does the organization do, and who does it serve?",
      "How big was the team, who did you report to, and who relied on your work?",
      "What was going on there when you joined? What problem or pressure was the team facing?",
    ],
  },
  {
    heading: "2. Responsibilities and your own contribution",
    prompts: [
      "Walk me through a typical week. What did you actually spend your time on?",
      "Which pieces were yours alone, and which did you share with others?",
      "When you say \"we\", what was your part?",
    ],
  },
  {
    heading: "3. Accomplishments, outcomes and evidence",
    prompts: [
      "What changed because you were there? What would not have happened without you?",
      "Can you put a number on it: people, time, money, volume, rank, frequency?",
      "How do you know? Was it measured, or is that your estimate?",
      "Did anyone recognize it: feedback, a promotion, more responsibility, being asked back?",
    ],
  },
  {
    heading: "4. Reactions and reflections",
    prompts: [
      "What did you enjoy most? What drained you?",
      "What are you proudest of from this experience?",
      "What would you do differently, or want more of, next time?",
    ],
  },
  {
    heading: "5. Follow up when an answer is vague",
    prompts: [
      "Can you give me a specific example of that?",
      "What happened next?",
      "What was the hardest part, and how did you handle it?",
      "Who else would describe your work there, and what would they say?",
    ],
  },
]

const EXPERIENCE_REMINDERS = [
  "Note whether a contribution was individual or team work.",
  "Note whether a result was measured or estimated, and where the number came from.",
  "Write down the client's own words when a phrase stands out.",
]

export const GUIDES: Record<WorkshopTab, Guide> = {
  education: {
    intro: "Go beyond the degree line: why this path, what they did with it, and what it says about how they learn.",
    sections: [
      { heading: "The basics", prompts: [
        "School, degree, major and minors, expected or actual graduation date.",
        "GPA, if it helps them, and any honors programs.",
      ] },
      { heading: "Choices and direction", prompts: [
        "Why this school and this major? Did the plan change along the way?",
        "Which classes or professors shaped how you think about your career?",
      ] },
      { heading: "Beyond the classroom", prompts: [
        "Study abroad, research, thesis or capstone work?",
        "Did you work while studying? How many hours a week?",
      ] },
    ],
    reminders: ["Note anything that belongs on another tab (coursework, projects, honors) and add it there or in Quick Capture."],
  },
  coursework: {
    intro: "Find the courses that prove relevant knowledge for the roles they are targeting.",
    sections: [
      { heading: "What to look for", prompts: [
        "Which courses connect most directly to the jobs you want?",
        "What did you produce in them: a model, a paper, a campaign, an analysis?",
        "Which tools, methods or software did you use?",
      ] },
      { heading: "Go deeper", prompts: [
        "What was the hardest course, and how did you do in it?",
        "Was any coursework team-based? What was your role?",
      ] },
    ],
    reminders: ["A course with a substantial deliverable may deserve an entry on Academic Projects."],
  },
  honors: {
    intro: "Capture every recognition, then find out what it took to earn it.",
    sections: [
      { heading: "The recognition", prompts: [
        "Name, who awarded it, and when.",
        "How selective was it? How many people were considered or chosen?",
      ] },
      { heading: "What earned it", prompts: [
        "What did you do to earn this?",
        "Did it lead to anything: a role, an opportunity, an introduction?",
      ] },
    ],
    reminders: ["Ask about scholarships, dean's list, competitions, and recognition at work, not only academic awards."],
  },
  certifications: {
    intro: "Confirm the details, then find out how the certification has been used.",
    sections: [
      { heading: "The credential", prompts: [
        "Exact name, issuing body, date earned, and expiry if any.",
        "Is it complete, or in progress? Expected completion date?",
      ] },
      { heading: "How it is used", prompts: [
        "Why did you pursue it?",
        "Where have you applied what you learned?",
      ] },
    ],
    reminders: ["Note whether it is earned or in progress so the resume states it accurately."],
  },
  experience: {
    intro: "Use this sequence as a guide, not a script. Follow the conversation and come back to what is missing.",
    sections: EXPERIENCE_SEQUENCE,
    reminders: EXPERIENCE_REMINDERS,
  },
  projects: {
    intro: "Treat a strong project like a job: context, contribution, outcome, reaction.",
    sections: [
      { heading: "1. Context", prompts: [
        "What was the project for: a class, a competition, a client, yourself?",
        "What was the goal, and how big was the team?",
      ] },
      { heading: "2. Your contribution", prompts: [
        "Which parts did you own? What decisions did you make?",
        "Which tools, methods or data did you use?",
      ] },
      { heading: "3. Outcomes and evidence", prompts: [
        "What did you deliver, and how was it received: grade, client response, results?",
        "Is there anything to show: a link, a deck, a report, code?",
      ] },
      { heading: "4. Reactions", prompts: [
        "What did you enjoy, and what was frustrating?",
        "What would you do differently?",
      ] },
    ],
    reminders: EXPERIENCE_REMINDERS,
  },
  skills: {
    intro: "List skills with proof. A skill on a resume should be backed by somewhere it was used.",
    sections: [
      { heading: "Technical and tools", prompts: [
        "Software, programming languages, platforms, data and design tools.",
        "How would you rate yourself, and where did you use each one?",
      ] },
      { heading: "Languages and other skills", prompts: [
        "Spoken languages and level of fluency.",
        "Other skills the target roles ask for: which can you back with an example?",
      ] },
    ],
    reminders: ["Note where each skill was used, so the resume can show it rather than only list it."],
  },
  leadership: {
    intro: "Leadership and involvement often hold the best stories. Explore them like work experience.",
    sections: [
      { heading: "1. The organization and your role", prompts: [
        "What is the group, how big is it, and what does it do?",
        "Elected, appointed, founding member, or volunteer? For how long?",
      ] },
      { heading: "2. What you actually did", prompts: [
        "What were you responsible for? Who did you lead or work with?",
        "What did you start, change or improve?",
      ] },
      { heading: "3. Results and evidence", prompts: [
        "What happened because of you: members, money raised, events, attendance?",
        "Measured or estimated?",
      ] },
      { heading: "4. Reactions", prompts: [
        "Why did you get involved, and what kept you there?",
        "What did it teach you about how you like to work?",
      ] },
    ],
    reminders: EXPERIENCE_REMINDERS,
  },
  other: {
    intro: "Anything that does not fit elsewhere: interests, side work, life experience, goals, concerns.",
    sections: [
      { heading: "Worth asking", prompts: [
        "Is there anything you have done that we have not talked about yet?",
        "Side projects, freelance work, family business, caregiving, athletics, hobbies with depth?",
        "Anything you are worried the resume will not show?",
      ] },
    ],
    reminders: ["Record what you heard. Interpretations can be marked as yours, for example \"Coach: ...\"."],
  },
}
