// docs/WRN_SIGNAL_Package_Seed.xlsx, the columns SIGNAL imports, as data.
// Generated from the sheet; The Proof Project is left out (parked).

export type SeedTask = { order: number; name: string; details: string | null; type: "coach" | "client"; owner: string }
export type SeedDeliverable = { phase: string; name: string; tasks: SeedTask[] }
export type SeedPackage = { name: string; kind: string; price: number; deliverables: string[] }

export const normName = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase()

export const SEED_DELIVERABLES: SeedDeliverable[] = [
  {
    "phase": "Know",
    "name": "Your SIGNAL DNA Assessment",
    "tasks": [
      {
        "order": 1,
        "name": "Book Your SIGNAL DNA Assessment",
        "details": null,
        "type": "client",
        "owner": "Client"
      },
      {
        "order": 2,
        "name": "Prepare for Your SIGNAL DNA Assessment",
        "details": null,
        "type": "coach",
        "owner": "Peri"
      },
      {
        "order": 3,
        "name": "Run Your SIGNAL DNA Assessment",
        "details": "Live on Teams",
        "type": "coach",
        "owner": "Peri"
      }
    ]
  },
  {
    "phase": "Know",
    "name": "Your SIGNAL DNA Report",
    "tasks": [
      {
        "order": 1,
        "name": "Prepare Your SIGNAL DNA report",
        "details": "Review all responses, write report (10 sections, four paths, entry points, comparison table), add Decoder links (write missing pages)",
        "type": "coach",
        "owner": "Peri"
      }
    ]
  },
  {
    "phase": "Know",
    "name": "Your SIGNAL DNA Decode and Career Path Session",
    "tasks": [
      {
        "order": 1,
        "name": "Book Decode session",
        "details": null,
        "type": "client",
        "owner": "Client"
      },
      {
        "order": 2,
        "name": "Prepare for Decode session",
        "details": null,
        "type": "coach",
        "owner": "Peri"
      },
      {
        "order": 3,
        "name": "Run Decode session",
        "details": "Walk through report and path comparison, capture questions and reactions, confirm paths",
        "type": "coach",
        "owner": "Peri"
      }
    ]
  },
  {
    "phase": "Build",
    "name": "Resume Workshop",
    "tasks": [
      {
        "order": 1,
        "name": "Book Resume Workshop",
        "details": "Upload instructions are in the welcome email",
        "type": "client",
        "owner": "Client"
      },
      {
        "order": 2,
        "name": "Prepare for Resume Workshop",
        "details": "Review current resume, background, Decode paths",
        "type": "coach",
        "owner": "Peri"
      },
      {
        "order": 3,
        "name": "Run Resume Workshop",
        "details": "Define job paths together, confirm paths in writing",
        "type": "coach",
        "owner": "Peri"
      }
    ]
  },
  {
    "phase": "Build",
    "name": "Resume",
    "tasks": [
      {
        "order": 1,
        "name": "Draft resume",
        "details": "Full rebuild line by line, variations by path, ATS structure check on all versions",
        "type": "coach",
        "owner": "Peri"
      },
      {
        "order": 2,
        "name": "Review draft and book Finalize session",
        "details": null,
        "type": "client",
        "owner": "Client"
      },
      {
        "order": 3,
        "name": "Prepare for Finalize session",
        "details": null,
        "type": "coach",
        "owner": "Peri"
      },
      {
        "order": 4,
        "name": "Run Resume Review/Finalize session",
        "details": null,
        "type": "coach",
        "owner": "Peri"
      },
      {
        "order": 5,
        "name": "Approve final resume",
        "details": "Client sign-off in Coaches Hub",
        "type": "client",
        "owner": "Client"
      }
    ]
  },
  {
    "phase": "Build",
    "name": "Cover Letter",
    "tasks": [
      {
        "order": 1,
        "name": "Draft cover letter framework",
        "details": "Capture client voice, write custom cover letter, build reusable framework; walkthrough is in the email",
        "type": "coach",
        "owner": "Peri"
      },
      {
        "order": 2,
        "name": "Review and edit cover letter",
        "details": null,
        "type": "client",
        "owner": "Client"
      },
      {
        "order": 3,
        "name": "Finalize cover letter",
        "details": "Back and forth by email, no session",
        "type": "coach",
        "owner": "Peri"
      },
      {
        "order": 4,
        "name": "Approve final cover letter",
        "details": "Client sign-off in Coaches Hub",
        "type": "client",
        "owner": "Client"
      }
    ]
  },
  {
    "phase": "Build",
    "name": "LinkedIn Rebuild",
    "tasks": [
      {
        "order": 1,
        "name": "Build LinkedIn Rebuild plan",
        "details": "Headline, summary, experience, positioning",
        "type": "coach",
        "owner": "Peri"
      },
      {
        "order": 2,
        "name": "Implement LinkedIn changes",
        "details": null,
        "type": "client",
        "owner": "Client"
      },
      {
        "order": 3,
        "name": "Review LinkedIn updates",
        "details": "No client sign-off; coach review is enough",
        "type": "coach",
        "owner": "Peri"
      }
    ]
  },
  {
    "phase": "Search",
    "name": "SIGNAL Setup and Job Search Strategy",
    "tasks": [
      {
        "order": 1,
        "name": "Book Job Search Strategy/Networking session",
        "details": null,
        "type": "client",
        "owner": "Client"
      },
      {
        "order": 2,
        "name": "Prepare for strategy session",
        "details": "Update profile, create personas, enter target roles/locations/goals, seed 1 to 2 jobs (required)",
        "type": "coach",
        "owner": "Peri"
      },
      {
        "order": 3,
        "name": "Run strategy session",
        "details": "Send SIGNAL invite live, full walkthrough, pursue and ignore rules, prioritization and sequencing, confirm campaign requirements",
        "type": "coach",
        "owner": "Peri"
      }
    ]
  },
  {
    "phase": "Search",
    "name": "Networking Campaign",
    "tasks": [
      {
        "order": 1,
        "name": "Complete Client Brief",
        "details": "Built in SIGNAL",
        "type": "coach",
        "owner": "Peri"
      },
      {
        "order": 2,
        "name": "Build networking campaign",
        "details": "100 to 300 targeted professionals; workbook saved to client Drive. Built in SIGNAL",
        "type": "coach",
        "owner": "Erin"
      },
      {
        "order": 3,
        "name": "Review campaign",
        "details": "Approve or request changes with feedback. Built in SIGNAL",
        "type": "coach",
        "owner": "Peri"
      },
      {
        "order": 4,
        "name": "Upload campaign and build plan",
        "details": "Built in SIGNAL",
        "type": "coach",
        "owner": "Peri"
      },
      {
        "order": 5,
        "name": "Share plan with client",
        "details": "Built in SIGNAL",
        "type": "coach",
        "owner": "Peri"
      },
      {
        "order": 6,
        "name": "Book Review Networking Plan session",
        "details": "Client sends outreach from their own email",
        "type": "client",
        "owner": "Client"
      },
      {
        "order": 7,
        "name": "Prepare for review session",
        "details": null,
        "type": "coach",
        "owner": "Peri"
      },
      {
        "order": 8,
        "name": "Run Review Networking Plan session",
        "details": "No recap email",
        "type": "coach",
        "owner": "Peri"
      }
    ]
  },
  {
    "phase": "Land",
    "name": "Interview Sessions 1 to 3",
    "tasks": [
      {
        "order": 1,
        "name": "Book Interview Session 1",
        "details": null,
        "type": "client",
        "owner": "Client"
      },
      {
        "order": 2,
        "name": "Prepare for Interview Session 1",
        "details": "Session 1 workbook",
        "type": "coach",
        "owner": "Peri"
      },
      {
        "order": 3,
        "name": "Run Interview Session 1",
        "details": null,
        "type": "coach",
        "owner": "Peri"
      },
      {
        "order": 4,
        "name": "Complete Session 1 homework",
        "details": null,
        "type": "client",
        "owner": "Client"
      },
      {
        "order": 5,
        "name": "Book Interview Session 2",
        "details": null,
        "type": "client",
        "owner": "Client"
      },
      {
        "order": 6,
        "name": "Prepare for Interview Session 2",
        "details": "Session 2 workbook",
        "type": "coach",
        "owner": "Peri"
      },
      {
        "order": 7,
        "name": "Run Interview Session 2",
        "details": null,
        "type": "coach",
        "owner": "Peri"
      },
      {
        "order": 8,
        "name": "Complete Session 2 homework",
        "details": null,
        "type": "client",
        "owner": "Client"
      },
      {
        "order": 9,
        "name": "Book Interview Session 3",
        "details": null,
        "type": "client",
        "owner": "Client"
      },
      {
        "order": 10,
        "name": "Prepare for Interview Session 3",
        "details": "Session 3 workbook",
        "type": "coach",
        "owner": "Peri"
      },
      {
        "order": 11,
        "name": "Run Interview Session 3",
        "details": null,
        "type": "coach",
        "owner": "Peri"
      },
      {
        "order": 12,
        "name": "Complete Session 3 homework",
        "details": null,
        "type": "client",
        "owner": "Client"
      }
    ]
  },
  {
    "phase": "Land",
    "name": "Mock Interview",
    "tasks": [
      {
        "order": 1,
        "name": "Book Mock Interview",
        "details": null,
        "type": "client",
        "owner": "Client"
      },
      {
        "order": 2,
        "name": "Prepare for mock interview",
        "details": null,
        "type": "coach",
        "owner": "Peri"
      },
      {
        "order": 3,
        "name": "Run and record mock interview",
        "details": "Save recording",
        "type": "coach",
        "owner": "Peri"
      },
      {
        "order": 4,
        "name": "Evaluate mock interview",
        "details": "Scorecard for content and delivery; shared via Library and email",
        "type": "coach",
        "owner": "Peri"
      }
    ]
  },
  {
    "phase": "Land",
    "name": "Pre-Interview Prep",
    "tasks": [
      {
        "order": 1,
        "name": "Prepare for pre-interview prep",
        "details": "Repeatable; client books anytime, no release",
        "type": "coach",
        "owner": "Peri"
      },
      {
        "order": 2,
        "name": "Run pre-interview prep",
        "details": null,
        "type": "coach",
        "owner": "Peri"
      }
    ]
  },
  {
    "phase": "Land",
    "name": "Offboarding",
    "tasks": [
      {
        "order": 1,
        "name": "Book Offboarding session",
        "details": null,
        "type": "client",
        "owner": "Client"
      },
      {
        "order": 2,
        "name": "Prepare for offboarding",
        "details": null,
        "type": "coach",
        "owner": "Peri"
      },
      {
        "order": 3,
        "name": "Run offboarding",
        "details": null,
        "type": "coach",
        "owner": "Peri"
      }
    ]
  }
]

export const SEED_PACKAGES: SeedPackage[] = [
  {
    "name": "Your SIGNAL DNA",
    "kind": "Bundle and a la carte",
    "price": 350,
    "deliverables": [
      "Your SIGNAL DNA Assessment",
      "Your SIGNAL DNA Report",
      "Your SIGNAL DNA Decode and Career Path Session"
    ]
  },
  {
    "name": "Know Where to Aim",
    "kind": "Bundle",
    "price": 800,
    "deliverables": [
      "Your SIGNAL DNA Assessment",
      "Your SIGNAL DNA Report",
      "Your SIGNAL DNA Decode and Career Path Session",
      "Resume Workshop",
      "Resume",
      "Cover Letter",
      "LinkedIn Rebuild"
    ]
  },
  {
    "name": "Run the Search",
    "kind": "Bundle",
    "price": 1750,
    "deliverables": [
      "Your SIGNAL DNA Assessment",
      "Your SIGNAL DNA Report",
      "Your SIGNAL DNA Decode and Career Path Session",
      "Resume Workshop",
      "Resume",
      "Cover Letter",
      "LinkedIn Rebuild",
      "SIGNAL Setup and Job Search Strategy",
      "Networking Campaign"
    ]
  },
  {
    "name": "All the Way Through",
    "kind": "Bundle",
    "price": 2500,
    "deliverables": [
      "Your SIGNAL DNA Assessment",
      "Your SIGNAL DNA Report",
      "Your SIGNAL DNA Decode and Career Path Session",
      "Resume Workshop",
      "Resume",
      "Cover Letter",
      "LinkedIn Rebuild",
      "SIGNAL Setup and Job Search Strategy",
      "Networking Campaign",
      "Interview Sessions 1 to 3",
      "Mock Interview",
      "Pre-Interview Prep",
      "Offboarding"
    ]
  },
  {
    "name": "Resume Rebuild",
    "kind": "A la carte",
    "price": 250,
    "deliverables": [
      "Resume Workshop",
      "Resume"
    ]
  },
  {
    "name": "Foundations",
    "kind": "A la carte",
    "price": 500,
    "deliverables": [
      "Resume Workshop",
      "Resume",
      "Cover Letter",
      "LinkedIn Rebuild"
    ]
  },
  {
    "name": "Job Search Strategy",
    "kind": "A la carte",
    "price": 1200,
    "deliverables": [
      "SIGNAL Setup and Job Search Strategy",
      "Networking Campaign"
    ]
  },
  {
    "name": "Interview Performance",
    "kind": "A la carte",
    "price": 1500,
    "deliverables": [
      "Interview Sessions 1 to 3",
      "Mock Interview",
      "Pre-Interview Prep",
      "Offboarding"
    ]
  }
]
