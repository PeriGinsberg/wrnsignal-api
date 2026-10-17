// The Meridian Card baseline: an interviewer-led growth case for a credit
// card issuer, eight questions in a fixed order. Fictional practice content,
// not American Express material. Written 2026-10-17 for Will Friedman's
// American Express Enterprise Strategy preparation, and reusable for anyone
// preparing for a financial services strategy case.

import type { CaseDefinition } from "../types"

export const meridianCardBaseline: CaseDefinition = {
  id: "meridian-card-baseline",
  title: "Meridian Card: growing spend from existing cardholders",
  round_title: "Amex Case Accelerator: Baseline Simulation",
  type: "growth_strategy",
  difficulty: "intermediate",
  industry: "Financial services: credit cards",
  employer_alignment: "American Express Enterprise Strategy",
  minutes: "20 to 25 minutes",
  skills: [
    "problem_understanding", "structuring", "prioritization", "hypothesis", "brainstorming",
    "quant_accuracy", "business_interpretation", "conciseness", "clarity", "recommendation",
  ],
  scenario:
    "Meridian Card is a national credit card company. (It is fictional: this is practice content, not real company data.)\n\n" +
    "Meridian wants to increase how much its existing cardholders spend on its cards each year, without significantly increasing its marketing budget. Leadership wants to find the most attractive growth initiative.\n\n" +
    "Your interviewer will take you through the case one question at a time.",
  instructions: [
    "This is a new case you have not seen. It runs as eight questions, in order, the way an interviewer would ask them.",
    "Each question shows how long you have. Some give you think time first: use it, or press Start answering when you are ready.",
    "Recording starts when your think time ends. Press Finish when you have made your point. You do not need to use all the time.",
    "Each answer is saved as you finish it, and there are no re-takes: treat it like the real thing.",
    "Have paper and a pen next to you for the math question.",
    "Lead with your main point. Show your approach to calculations. Explain what the numbers mean.",
  ],
  self_assessment: [
    { key: "longest", question: "Which question took you the longest to organize your thoughts?" },
    { key: "overexplained", question: "Where did you feel you gave more explanation than necessary?" },
    { key: "strongest", question: "Which answer do you think was your strongest?" },
    { key: "redo", question: "Which answer would you redo if you had another opportunity?" },
    { key: "skill", question: "What is the single biggest skill you want to improve before Wednesday?" },
  ],
  questions: [
    {
      qkey: "q1",
      title: "Business understanding",
      text: "Meridian wants to increase spending among existing cardholders without substantially increasing marketing costs. How would you summarize the business problem we're trying to solve?",
      answer_seconds: 45,
      prep_seconds: 15,
      dimensions: ["problem_understanding", "conciseness", "clarity"],
      coach: {
        purpose: "Can he play the problem back in one or two sentences, keeping the constraint, before he starts solving?",
        strong: [
          "Names the objective: more annual spend per existing cardholder, so more revenue from the base it already has.",
          "Keeps the constraint: without a meaningful rise in marketing spend, so the answer has to come from the product, rewards, partnerships or engagement rather than buying attention.",
          "Says what a good answer decides: which initiative gives the most profitable incremental spend.",
          "Done in well under the 45 seconds. Checks alignment in a line, if at all.",
        ],
        example: "We're trying to grow revenue from Meridian's existing cardholders by getting them to put more of their spending on the card, without leaning on a bigger marketing budget. So the question is which initiative drives the most profitable incremental spend from customers we already have. Is that the right way to think about it?",
        alternatives: [
          "Framing it as share of wallet: cardholders already spend; the goal is moving more of it onto Meridian.",
          "Splitting it into frequency (more transactions) and ticket size (bigger transactions). Fine if kept to one line.",
        ],
        common_errors: [
          "Dropping the marketing constraint, then later proposing a big advertising push.",
          "Starting the structure or brainstorming here, which is the next question.",
          "Asking several clarifying questions when one, or none, would do.",
        ],
        overanalysis: [
          "Restating the whole prompt word for word before summarising it.",
          "More than three sentences, or going past 30 seconds.",
        ],
        poor_prioritization: [
          "Treating 'increase spending' and 'keep marketing flat' as two separate problems rather than one problem with a constraint.",
        ],
        interventions: [
          "Give me the problem in one sentence.",
          "What's the constraint, and why does it matter for what we could recommend?",
        ],
      },
    },
    {
      qkey: "q2",
      title: "Problem structure",
      text: "What are the most important factors you would investigate to understand how Meridian could increase cardholder spending?",
      answer_seconds: 120,
      prep_seconds: 30,
      dimensions: ["structuring", "prioritization", "clarity", "conciseness"],
      coach: {
        purpose: "Can he build a small, fitted structure quickly, say it so it can be written down, and say where he would start?",
        strong: [
          "Two to four buckets, announced up front ('I'd look at three things').",
          "Buckets that fit spend growth, for example: who the cardholders are and how they use the card now (segments, categories, share of wallet); why they do not use it more (acceptance, rewards fit, top-of-wallet competition, habit); and what levers Meridian controls at low cost (rewards, offers, partnerships, digital features), with the economics of each.",
          "One or two concrete examples per bucket, not ten.",
          "Ends with where he would go first and why.",
        ],
        example: "I'd look at three things. First, current behaviour: which segments use the card, for which categories, and what share of their total spending we capture. Second, the barriers: why people don't use the card more, whether that's acceptance, rewards that don't fit everyday spend, or another card sitting at the top of the wallet. Third, the levers we control without big marketing spend, like rewards changes, merchant partnerships and in-app offers, and what each would cost per dollar of new spend. I'd start with current behaviour, because the gap between total wallet and what we capture tells us where the upside is.",
        alternatives: [
          "Customer / product / competition / economics. Fine if it is tailored and not recited.",
          "Frequency versus ticket size, then segment within each. Valid if it reaches the levers.",
          "Starting from the P&L (spend, then revenue per dollar, then cost to drive it). Acceptable if it does not crowd out the customer view.",
        ],
        common_errors: [
          "Reciting a generic profitability framework (revenue minus costs) when the question is about spend behaviour.",
          "Six or more buckets, or buckets that overlap.",
          "Never saying where he would start.",
        ],
        overanalysis: [
          "Using the full two minutes when the structure was clear by 60 seconds.",
          "Listing every sub-factor under each bucket.",
          "Going back to add a fourth and fifth bucket after closing.",
        ],
        poor_prioritization: [
          "All buckets presented as equal, with no 'first'.",
          "Starting with costs or competitors when the question is about cardholder behaviour.",
        ],
        interventions: [
          "Which two factors matter most?",
          "If you could only look at one thing on Monday, what would it be?",
          "Say it again in 30 seconds.",
        ],
      },
    },
    {
      qkey: "q3",
      title: "Hypothesis and prioritization",
      text: "Meridian's leadership believes many customers use its card for travel and restaurants but not for everyday purchases. Where would you investigate first, and why?",
      answer_seconds: 60,
      prep_seconds: 15,
      dimensions: ["hypothesis", "prioritization", "conciseness"],
      coach: {
        purpose: "Does he take the leadership hypothesis, sharpen it, and name the first thing to check, with a reason, in one minute?",
        strong: [
          "Leads with where he would look first, in the first sentence.",
          "Turns the belief into something testable: compare spend by category against what these customers likely spend in total (share of wallet in groceries, gas, pharmacy, subscriptions).",
          "Gives the reason: everyday categories are frequent and large in total, so even a small shift is a lot of volume.",
          "Optionally names why it might be happening (rewards skewed to travel and dining, a debit or cashback card winning everyday, acceptance) as what he would test next.",
        ],
        example: "I'd start by checking whether the belief is true and how big the gap is: compare what our cardholders put on the card in everyday categories like groceries, gas and subscriptions with what customers like them typically spend there. If the gap is large, that's where the upside is, because everyday spend is frequent and adds up. Then I'd look at why: most likely our rewards favour travel and dining, so another card wins everyday purchases.",
        alternatives: [
          "Starting with the 'why' (survey or rewards comparison) if he states that he is assuming the belief is true.",
          "Segmenting first: which cardholders show the pattern most, since a targeted fix is cheaper.",
        ],
        common_errors: [
          "Accepting the hypothesis without testing it.",
          "Listing five places to look with no first.",
          "Jumping to initiatives, which is the next question.",
        ],
        overanalysis: [
          "Re-building the whole structure from Q2 before answering.",
          "Explaining data sources in detail.",
        ],
        poor_prioritization: [
          "Investigating travel and dining, which are already working, before the everyday gap.",
        ],
        interventions: [
          "What's your headline?",
          "Give me your answer in one sentence.",
          "What would you look at first, and what would it tell you?",
        ],
      },
    },
    {
      qkey: "q4",
      title: "Brainstorming",
      text: "What initiatives could Meridian introduce to encourage customers to use its card more frequently for everyday purchases? Organize your ideas and identify the two you find most promising.",
      answer_seconds: 90,
      prep_seconds: 30,
      dimensions: ["brainstorming", "prioritization", "clarity"],
      coach: {
        purpose: "Can he generate practical ideas, group them on the fly, respect the low-marketing constraint, and commit to two with reasons?",
        strong: [
          "Announces groups before ideas, for example: rewards, partnerships, product and experience.",
          "Rewards: bonus points or cashback on groceries and gas; rotating everyday categories.",
          "Partnerships: co-funded offers with grocers, fuel or subscription services (the merchant pays for much of it, which fits the constraint).",
          "Product and experience: easy recurring-bill set-up, default card in digital wallets, in-app targeted offers, card-linked offers.",
          "Picks two and says why, tied to the objective and the constraint: for example merchant-funded offers (low cost to Meridian) and everyday category rewards (directly targets the gap).",
        ],
        example: "I'd group ideas into three areas. Rewards: higher points on groceries, gas and pharmacy. Partnerships: merchant-funded offers with big everyday retailers. And habits: make Meridian the default for recurring bills and in digital wallets. My two picks are merchant-funded offers, because partners carry most of the cost, which fits the budget constraint, and recurring-bill set-up, because once a bill is on the card the spend repeats every month without more marketing.",
        alternatives: [
          "Grouping by customer journey (sign-up, everyday use, loyalty).",
          "Grouping by who pays (Meridian, partners, the customer). A sharp choice given the constraint.",
          "Picking everyday rewards as one of the two, as long as he notes the cost.",
        ],
        common_errors: [
          "A long unsorted list.",
          "Ideas that need large marketing spend (TV campaigns, acquisition offers), which ignore the constraint and target new rather than existing customers.",
          "Not picking two, or picking two without reasons.",
        ],
        overanalysis: [
          "Eight or more ideas when four to six well-grouped ones would do.",
          "Explaining how each idea would be implemented.",
        ],
        poor_prioritization: [
          "Choosing the two most creative ideas rather than the two that best fit the objective and the constraint.",
        ],
        interventions: [
          "Which two would you bet on, and why those?",
          "Which of these respects the marketing constraint best?",
        ],
      },
    },
    {
      qkey: "q5",
      title: "Quantitative analysis",
      text: "Estimate the additional annual purchase volume, additional annual net revenue before program costs, and annual contribution after the rewards program cost. Walk me through your calculation.",
      exhibit:
        "Meridian has 2 million active cardholders.\n" +
        "Management estimates that 25% could be persuaded to spend an additional $200 per month on the card.\n" +
        "Meridian earns an average of 1.8% of purchase volume in net revenue, before incremental program costs.\n" +
        "The proposed rewards initiative would cost $12 million a year.",
      answer_seconds: 180,
      prep_seconds: 60,
      dimensions: ["quant_accuracy", "business_interpretation", "clarity"],
      coach: {
        purpose: "Does he state the approach before computing, keep the units straight, get the numbers right, and say what the result means?",
        strong: [
          "States the plan first: participants, then monthly and annual volume, then revenue, then minus cost.",
          "Talks through each step out loud so the interviewer can follow.",
          "Gets $1.2 billion, $21.6 million and $9.6 million.",
          "Ends with the so-what: positive on paper, but it rests on the 25% and on the spend being genuinely new.",
        ],
        example: "I'll go in three steps. Participants: 25% of 2 million is 500,000 cardholders. Each spends $200 more a month, so $2,400 a year, which makes 500,000 times $2,400, or $1.2 billion of extra purchase volume. At 1.8%, that's $21.6 million of net revenue before program costs. Take away the $12 million program cost and the contribution is $9.6 million a year. So it pays back on paper, but only if those cardholders really are spending more rather than moving spend they would have put on the card anyway, and only if 25% actually take part.",
        calculation: [
          "Participants: 2,000,000 x 25% = 500,000 cardholders.",
          "Additional annual purchase volume: 500,000 x $200 x 12 = $1.2 billion.",
          "Additional annual net revenue before program costs: $1.2 billion x 1.8% = $21.6 million.",
          "Annual contribution after program costs: $21.6 million - $12 million = $9.6 million.",
        ],
        alternatives: [
          "Annualising first ($200 x 12 = $2,400 per participant) then multiplying by participants. Same answer.",
          "Computing revenue per participant ($2,400 x 1.8% = $43.20) then scaling: $43.20 x 500,000 = $21.6 million.",
          "Break-even framing: $12 million / 1.8% = $667 million of incremental volume needed, so the plan clears break-even with room to spare. A strong extra, not required.",
        ],
        common_errors: [
          "Forgetting to annualise (using $200 instead of $2,400), giving $100 million volume and $1.8 million revenue.",
          "Applying 25% twice or not at all.",
          "Unit slips between millions and billions (for example $1.2 million volume).",
          "Treating 1.8% as 18% or 0.18%.",
          "Stopping at $9.6 million with no interpretation.",
        ],
        overanalysis: [
          "Building a multi-year model, adding churn or discounting that was not asked for, before giving the three numbers.",
          "Second-guessing every input aloud before calculating.",
        ],
        poor_prioritization: [
          "Spending the time on caveats and running out before the third number.",
        ],
        interventions: [
          "Tell me the equation before you put numbers in.",
          "What does that number mean for the business?",
          "Sanity check: does $1.2 billion feel right for 500,000 people?",
        ],
      },
    },
    {
      qkey: "q6",
      title: "Interpretation",
      text: "Based on those numbers, would you recommend launching the program as proposed? What would you want to understand before making a final decision?",
      answer_seconds: 90,
      prep_seconds: 20,
      dimensions: ["business_interpretation", "recommendation", "prioritization", "conciseness"],
      coach: {
        purpose: "Does he give a position first, then the two or three assumptions that would change it, rather than an unordered list of unknowns?",
        strong: [
          "Opens with a position: promising but not ready to launch at full scale as proposed, or launch with conditions.",
          "Incrementality: is the $200 genuinely new spend, or spend these customers would have put on the card anyway (or moved from another Meridian product)?",
          "Participation: is 25% realistic, and what is it based on?",
          "Costs and risks not in the $12 million: credit losses on extra spend, servicing, cannibalising existing rewards, reaction from competitors.",
          "Points to a way to find out cheaply (sets up the pilot in Q7).",
        ],
        example: "Not as proposed, at least not at full scale yet. The $9.6 million looks attractive, but it depends on two assumptions I'd want to test: that the $200 a month is genuinely new spend rather than spend that would have happened anyway, and that 25% of cardholders actually take part. I'd also check whether the $12 million covers everything, like extra credit losses and servicing. If we can test those cheaply first, I'd want to.",
        alternatives: [
          "'Yes, launch' is acceptable if he names the conditions and the key risk; the quality is in the reasoning, not the yes or no.",
          "Framing around sensitivity: at what participation rate does it break even (about 13.9% at $200 a month)? A strong answer.",
        ],
        common_errors: [
          "A list of eight unknowns with no ranking.",
          "No position at all ('it depends').",
          "Re-doing the math from Q5.",
        ],
        overanalysis: [
          "Spending the full 90 seconds on caveats before saying yes or no.",
        ],
        poor_prioritization: [
          "Leading with minor issues (operational set-up, branding) over incrementality and participation.",
        ],
        interventions: [
          "Yes or no first, then why.",
          "Which one assumption would change your answer?",
        ],
      },
    },
    {
      qkey: "q7",
      title: "New information",
      text: "How would you evaluate whether this pilot was successful?",
      exhibit:
        "New information:\n" +
        "A smaller pilot could be run with 100,000 cardholders.\n" +
        "The pilot would cost $500,000.\n" +
        "Management believes it could measure changes in card spending, customer engagement and incremental revenue over three months.",
      answer_seconds: 90,
      prep_seconds: 20,
      dimensions: ["hypothesis", "structuring", "business_interpretation", "clarity"],
      coach: {
        purpose: "Does he define success before the pilot runs, with a control group and a threshold, rather than 'see if spending goes up'?",
        strong: [
          "A control group: compare pilot cardholders with a similar group who did not get the program, so the lift is incremental.",
          "The key metrics: incremental spend per participant, participation rate, and incremental net revenue against the pilot cost.",
          "A threshold set in advance, tied to the full-scale case: for example, does the lift and participation support the full program clearing its $12 million cost, and roughly what participation rate is needed.",
          "Watch-outs: three months may overstate novelty, so look at whether spend holds in month three; check credit quality.",
        ],
        example: "I'd judge it on whether it proves the two assumptions the business case rests on. First, run it against a control group, so we're measuring genuinely incremental spend, not spend that would have happened anyway. Second, set the bar up front: participation near 25% and around $200 a month of extra spend, or at least enough to clear the program cost at full scale. I'd also check that spend holds in month three, not just month one, and that credit losses don't rise. If it clears those, scale it.",
        alternatives: [
          "Framing by short-term (spend, participation), medium-term (retention, engagement) and economics. Fine if a threshold is set.",
          "A pass/fail break-even test (about 13.9% participation at $200 a month, or about $111 a month at 25% participation) is excellent.",
        ],
        common_errors: [
          "No control group, so success is just 'spend went up'.",
          "Measuring engagement without tying it to revenue.",
          "No threshold for go or no-go.",
          "Forgetting the $500,000 cost relative to what is learned.",
        ],
        overanalysis: [
          "Designing the full experiment (sample sizes, statistical tests) in detail.",
        ],
        poor_prioritization: [
          "Leading with engagement metrics instead of incremental spend.",
        ],
        interventions: [
          "What's the one number that tells you it worked?",
          "Compared with what?",
        ],
      },
    },
    {
      qkey: "q8",
      title: "Executive recommendation",
      text: "Imagine you're updating Meridian's Chief Strategy Officer. What would you recommend, why, and what should the company do next?",
      answer_seconds: 60,
      prep_seconds: 30,
      dimensions: ["recommendation", "conciseness", "clarity", "business_interpretation"],
      coach: {
        purpose: "Can he close like a consultant: recommendation, two reasons, one risk, next step, in a minute?",
        strong: [
          "First sentence is the decision: run the $500,000 pilot before committing $12 million.",
          "Two reasons: the full program looks worth about $9.6 million a year on paper; the pilot tests the two assumptions it rests on for a small fraction of the cost.",
          "One risk: the extra spend may not be incremental, or may fade after the novelty.",
          "Next step: launch the 100,000-cardholder pilot with a control group and a go/no-go threshold, decide in three months.",
          "About 60 seconds. No recap of the whole case.",
        ],
        example: "My recommendation is to run the pilot before launching the full program. Two reasons: the full program could add about $9.6 million a year, and the pilot lets us test whether the extra spend is real for $500,000, less than five percent of the full cost. The main risk is that the spend isn't genuinely incremental, or fades after the first few months. Next step: launch the pilot with 100,000 cardholders and a control group, agree the success bar now, and decide on full launch in three months.",
        alternatives: [
          "Recommending full launch is acceptable if it is justified, comes with the main risk, and with a way to monitor it.",
        ],
        common_errors: [
          "Narrating the case in order instead of starting with the answer.",
          "No next step, or a vague one ('do more analysis').",
          "Three or more risks.",
        ],
        overanalysis: [
          "Going well over 60 seconds.",
          "Repeating all the numbers from Q5.",
        ],
        poor_prioritization: [
          "Leading with the risks before the recommendation.",
        ],
        interventions: [
          "What would you tell the Chief Strategy Officer?",
          "Give me your answer in one sentence.",
          "Recommendation, two reasons, one risk, next step. Go again.",
        ],
      },
    },
  ],
  coach: {
    answer_key: [
      "Additional annual purchase volume: 2,000,000 x 25% x $200 x 12 = $1.2 billion.",
      "Additional annual net revenue before program costs: $1.2 billion x 1.8% = $21.6 million.",
      "Annual contribution after program costs: $21.6 million - $12 million = $9.6 million.",
      "Break-even (extra, not required): $12 million / 1.8% = about $667 million of incremental volume; at $2,400 a year each, about 278,000 participants, or about 13.9% of cardholders. Equivalently, at $200 a month the break-even participation is about 13.9%; at 25% participation the break-even extra spend is about $111 a month.",
    ],
    qualifications: [
      "The extra spending must be genuinely incremental, not spend that would have happened anyway or that moves from another Meridian product.",
      "The 25% participation rate has to be achieved; it is a management estimate.",
      "The stated economics must capture all relevant costs (credit losses on the extra spend, servicing, cannibalisation of existing rewards).",
      "Strong candidates raise these without being asked, and connect them to the pilot.",
    ],
    model_reasoning:
      "The case moves from framing (Q1 to Q3) to ideas (Q4) to economics (Q5 to Q7) to a decision (Q8). A strong candidate keeps the objective and the low-marketing constraint alive throughout, lets the numbers drive a position rather than a list of caveats, and lands on the logical answer: the program is attractive on paper, its value rests on incrementality and participation, so test it with the pilot (a small cost against a $9.6 million upside) with a control group and a threshold agreed in advance.",
    diagnosis: {
      analytical: [
        "The structure is missing or does not fit the question, even when given time.",
        "The math setup is wrong (not only slow).",
        "Interpretation misses incrementality even when prompted.",
        "The recommendation does not follow from his own numbers.",
      ],
      communication: [
        "The right content is there but arrives late: the point is in the last 20 seconds of the answer.",
        "He reaches the answer, then keeps going and adds a second lap.",
        "Long think time followed by a clear answer (an organisation-speed issue, not an analytical one).",
        "The transcript reads well once you strip the first third; the headline exists but is buried.",
        "Answers run to the time limit on questions where the content was complete at half time.",
      ],
    },
    coaching_prompts: [
      "What's your headline?",
      "Which two factors matter most?",
      "Give me your answer in one sentence.",
      "What does that number mean for the business?",
      "What would you tell the Chief Strategy Officer?",
    ],
  },
}
