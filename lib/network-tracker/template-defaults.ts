// lib/network-tracker/template-defaults.ts
// The 24 WRN v3 message templates, verbatim from the Message Templates tab.
// Bodies hold [BRACKET] variables that resolve at render — never edit brackets to
// literal values here. See TEMPLATES.md for the three variable kinds.

export interface TemplateDefault {
  id: string
  label: string
  body: string
}

export const TEMPLATE_DEFAULTS: TemplateDefault[] = [
  {
    id: "IN",
    label: "Ask a mutual for an intro",
    body: `Hi [MUTUAL], quick favour. I'm working on moving into [TARGET_FIELD], and I noticed you're connected to [NAME] at [FIRM]. Would you be comfortable introducing us over email or LinkedIn? Completely fine if not. If it helps, I'm happy to write a short blurb you can just forward, so it's no work on your end.`,
  },
  {
    id: "P1",
    label: "Touch 1  \u00b7  day 0",
    body: `Hi [NAME], hope you're doing well. I've been getting serious about moving into [TARGET_FIELD], and you'd have a much better read on [FIRM] than anything I can find online. Any chance I could grab 15-20 minutes with you in the next couple of weeks? Would really appreciate it.`,
  },
  {
    id: "P2",
    label: "Touch 2  \u00b7  day 7",
    body: `Hi [NAME], just floating this back up in case it got buried. No rush at all, and I completely understand if now's a busy stretch. Would still love to catch up whenever works for you.`,
  },
  {
    id: "P3",
    label: "Touch 3  \u00b7  day 12",
    body: `Hi [NAME], last note from me so I'm not cluttering your inbox. If a call isn't realistic right now, no problem at all. And if there's someone else at [FIRM] you'd point me toward, I'd welcome that too. Either way, hope you're well.`,
  },
  {
    id: "A1",
    label: "Touch 1  \u00b7  day 0",
    body: `Hi [NAME], reaching out as a fellow [AFFINITY_1]. I'm [CURRENT_ROLE] at [CURRENT_EMPLOYER] and I'm working toward [TARGET_ROLE], so I was glad to see you at [FIRM]. I'd really value 15 minutes to hear how you got there and what the work is actually like day to day. Would you be open to a quick call in the next few weeks?`,
  },
  {
    id: "A2",
    label: "Touch 2  \u00b7  day 7",
    body: `Hi [NAME], following up on my note from last week. I know [AFFINITY_1] people probably get a lot of these, so no hard feelings if the timing isn't right. If it's easier, I'm happy to just send two or three specific questions over email instead of asking for time on your calendar.`,
  },
  {
    id: "A3",
    label: "Touch 3  \u00b7  day 12",
    body: `Hi [NAME], I'll leave it here so I'm not a nuisance. If a conversation ever opens up I'd still love it. And if there's someone else on your team who'd be a better person to ask, I'd be grateful for the name. Either way, good to see another [AFFINITY_1] doing well at [FIRM].`,
  },
  {
    id: "R1",
    label: "Touch 1  \u00b7  day 0",
    body: `Hi [NAME], [MUTUAL] suggested I reach out. I'm [CURRENT_ROLE] at [CURRENT_EMPLOYER] looking to move into [TARGET_ROLE], and [MUTUAL] thought you'd have a useful perspective on [FIRM]. Would you have 15 minutes in the next couple of weeks? Happy to work entirely around your schedule.`,
  },
  {
    id: "R2",
    label: "Touch 2  \u00b7  day 7",
    body: `Hi [NAME], circling back on my note from last week. I know [MUTUAL] speaks highly of you and I don't want to be a bother. If now isn't a good time, just say the word and I'll follow up further down the line.`,
  },
  {
    id: "R3",
    label: "Touch 3  \u00b7  day 12",
    body: `Hi [NAME], last follow-up from me. Completely understand if the timing doesn't work. If it's easier, I'm glad to send a couple of questions over email instead. Thanks for considering it either way, and I'll let [MUTUAL] know I appreciated the introduction.`,
  },
  {
    id: "C1",
    label: "Touch 1  \u00b7  day 0",
    body: `Hi [NAME], I'm [CURRENT_ROLE] at [CURRENT_EMPLOYER], working toward [TARGET_ROLE] in [CITY]. I'd rather learn what the work is really like from someone doing it than guess from the outside, and your background at [FIRM] stood out to me. If you had 15 minutes in the next few weeks, I'd value your perspective. Completely understand if the timing is off.`,
  },
  {
    id: "C2",
    label: "Touch 2  \u00b7  day 7",
    body: `Hi [NAME], following up once in case my note got lost. To make this easy: the main thing I'm trying to understand is [ONE SPECIFIC QUESTION]. Happy to take that over email if a call isn't practical, even a two-line answer would be genuinely useful.`,
  },
  {
    id: "C3",
    label: "Touch 3  \u00b7  day 12",
    body: `Hi [NAME], I won't keep filling your inbox, so this is my last note. If you're open to a short conversation at any point, I'd welcome it. And if someone else on your team would be a better person to ask, I'd be grateful for a name. Thanks for your time either way.`,
  },
  {
    id: "X1",
    label: "Touch 1  \u00b7  day 0",
    body: `Hi [NAME], I'm [CURRENT_ROLE] at [CURRENT_EMPLOYER], with [KEY_STRENGTH]. I'm interested in [TARGET_ROLE] openings at [FIRM] and wanted to put myself on your radar directly rather than disappear into the portal. Resume attached. If there's something open now or coming up, I'd welcome the chance to be considered.`,
  },
  {
    id: "X2",
    label: "Touch 2  \u00b7  day 7",
    body: `Hi [NAME], checking back on my note from last week; resume attached again for convenience. If [FIRM] isn't hiring for [TARGET_ROLE] right now, it would still help me a lot to know roughly when that cycle usually opens, so I can time things better.`,
  },
  {
    id: "X3",
    label: "Touch 3  \u00b7  day 12",
    body: `Hi [NAME], last note from me. If you'd rather I just apply through the careers page and stop emailing, tell me and I'll do exactly that, no hard feelings. Either way I'd like to stay on your radar for [TARGET_ROLE] roles. Thank you for your time.`,
  },
  {
    id: "S1",
    label: "Scheduling",
    body: `Thanks so much, [NAME], I really appreciate it. Would any of these work for 15-20 minutes: [OPTION 1], [OPTION 2], or [OPTION 3]? Happy to work around your schedule, and I'm flexible on Zoom or phone.`,
  },
  {
    id: "S2",
    label: "Thank-you  \u00b7  within 24h",
    body: `Hi [NAME], thank you for the time today. Your point about [SPECIFIC THING THEY SAID] really stuck with me, and [ONE CONCRETE THING YOU'LL DO BECAUSE OF IT]. I'll keep you posted on how it goes. And if there's ever anything I can do for you, please just ask.`,
  },
  {
    id: "S3",
    label: "Nurture  \u00b7  every 4-8 weeks",
    body: `Hi [NAME], saw [ARTICLE / NEWS ABOUT THEIR FIRM] and thought of our conversation. Hope [SPECIFIC THING THEY MENTIONED] is going well. No need to reply, just wanted to stay in touch.`,
  },
  {
    id: "S4",
    label: "The ask",
    body: `Hi [NAME], I've decided [FIRM] is exactly the kind of place I want to be, and our conversation is a big part of why. Two things that would help enormously: first, whether you'd be open to referring me through your internal process, and second, whether there's a recruiter or hiring manager you'd suggest I get in front of. I completely understand if neither is possible, resume attached either way, in case it's useful.`,
  },
  {
    id: "S5",
    label: "Post-referral thanks",
    body: `[NAME], thank you, sincerely. I know a referral means putting your name next to mine, and I won't take that lightly. I'll let you know how it unfolds. Whatever happens, I appreciate you making time for someone earlier in the journey, I'll pay it forward.`,
  },
  {
    id: "L1",
    label: "Connect note  \u00b7  affinity",
    body: `Hi [NAME], fellow [AFFINITY_1] here. I'm [CURRENT_ROLE] working toward [TARGET_ROLE], and I'd value your read on [FIRM] at some point. Would like to connect.`,
  },
  {
    id: "L2",
    label: "Connect note  \u00b7  cold",
    body: `Hi [NAME], I'm [CURRENT_ROLE] at [CURRENT_EMPLOYER], working toward [TARGET_ROLE]. Your path at [FIRM] is one I'd like to understand better. Open to connecting?`,
  },
  {
    id: "L3",
    label: "First DM after they accept",
    body: `Thanks for connecting, [NAME]. Short version: I'm [CURRENT_ROLE] at [CURRENT_EMPLOYER] trying to move into [TARGET_FIELD], and I'd rather hear what the work is actually like from someone in it than guess from the outside. If you had 15 minutes in the next few weeks I'd really value it. No worries at all if the timing's off.`,
  },
]
