# Stage 1 JD-side shadow agreement report

Coverage: 693/697 JDs with LLM extraction (null=4; sources {"cache":30,"live":663,"error":4})

## Headline
- Unit key (micro): precision 39.1%, recall 65.8%, Jaccard 32.5%
- Stable-scalar mean agreement: 85.1%

## Units
- macro: P 38.0% / R 67.8% / J 32.2%
- "other"-rate: 14.8% (1325 units)
- count delta (llm−regex): mean 7.72, median 8, range [-12,19]; %JDs llm>regex 98.3%
- matched-key: requiredness 45.6%, strength±2 63.8% (2370 pairs)
- kind distribution regex={"execution":829,"tool":1329,"function":1017,"deliverable":240,"stakeholder":185} llm={"function":5174,"execution":635,"deliverable":421,"tool":1760,"domain":808,"environment":92,"stakeholder":59}

### "other" label histogram (top)
- 26× bachelor's degree
- 6× valid driver's license
- 5× bilingual english/spanish
- 4× bachelor's degree in relevant field
- 4× attention to detail
- 4× occasional travel
- 3× willingness to travel
- 3× project management skills
- 3× negotiation skills
- 3× life sciences supply chain & manufacturing experience
- 3× willing to travel up to 75%
- 3× mouse handling and procedures
- 3× flow cytometry and immunoassays
- 3× handle confidential information
- 3× laboratory animal handling (mice)
- 3× single cell suspension preparation
- 3× immunofluorescence cell staining
- 3× binding affinity assay
- 3× cellular biology lab experience
- 3× time management and organizational skills
- 3× 3+ years leading recruiting teams
- 3× minimum 3.0 gpa
- 3× demonstrated leadership experience
- 2× bachelor's in quantitative field
- 2× 2-3 years pr experience

## Stable scalars (headline)
- mbaRequired: 99.7% (n=693; rxTrue/llmFalse=0, rxFalse/llmTrue=2)
- bachelorRequired: 63.1% (n=693; rxTrue/llmFalse=10, rxFalse/llmTrue=246)
- credentialRequired: 95.1% (n=693; rxTrue/llmFalse=2, rxFalse/llmTrue=32)
- credentialSponsored: 98.7% (n=693; rxTrue/llmFalse=4, rxFalse/llmTrue=5)
- isContract: 95.8% (n=693; rxTrue/llmFalse=1, rxFalse/llmTrue=28)
- isHourly: 96.1% (n=693; rxTrue/llmFalse=1, rxFalse/llmTrue=26)
- isGovernment: 94.5% (n=693; rxTrue/llmFalse=25, rxFalse/llmTrue=13)
- isTrainingProgram: 83.1% (n=693; rxTrue/llmFalse=16, rxFalse/llmTrue=101)
- isSalesHeavy: 85.4% (n=693; rxTrue/llmFalse=87, rxFalse/llmTrue=14)
- mentionsPharmaTraining: 100.0% (n=693; rxTrue/llmFalse=0, rxFalse/llmTrue=0)
- territoryUndisclosed: 99.0% (n=693; rxTrue/llmFalse=1, rxFalse/llmTrue=6)
- requiresAdvisoryBackground: 99.3% (n=693; rxTrue/llmFalse=0, rxFalse/llmTrue=5)
- requiresSoftCredential: 97.8% (n=693; rxTrue/llmFalse=0, rxFalse/llmTrue=15)
- location.constrained: 48.8% (n=693; rxTrue/llmFalse=1, rxFalse/llmTrue=354)
- yearsRequired: 74.9% (±1)
- gradYearHint: 97.5% (±1)
- location.mode: 59.3%
- credentialDetail: 95.4% (presence)
- softCredentialDetail: 95.2% (presence)
- location.city: 77.3% (presence)
- toolSet: Jaccard 31.9%, P 40.0%, R 61.4%
- isPartTime: 30/693 LLM-flagged (regex unset — dead gate)

## Judgment scalars (SOFT — directional, excluded from headline)
- isSeniorRole: 87.0% (rxTrue/llmFalse=61, rxFalse/llmTrue=29)
- requiresDomainIndustryExperience: 74.7% (rxTrue/llmFalse=14, rxFalse/llmTrue=161)
- isContentExecutionHeavy: 80.7% (rxTrue/llmFalse=0, rxFalse/llmTrue=134)
- requiresFinancialModeling: 97.4% (rxTrue/llmFalse=14, rxFalse/llmTrue=4)
- analytics.isHeavy: 82.5% (rxTrue/llmFalse=22, rxFalse/llmTrue=99)
- jobFamily: 57.9%
- financeSubFamily: 90.8%
- salesSubFamily: 68.8%
- jobArchetype: 22.1%
- jobIndustry: 3.9% (presence)
- detectedDomain: 33.6% (presence)

## jobFamily confusion (regex row → llm col)
- Accounting: Operations=1, IT_Software=2, Marketing=1, Accounting=1
- Analytics: Analytics=4, Marketing=4, Operations=9, Other=2, Engineering=3, Government=1, Finance=1
- Consulting: Operations=17, Consulting=34, Sales=7, IT_Software=2, Marketing=2, Finance=9, Analytics=3, Healthcare=1
- Engineering: IT_Software=2, Engineering=18, Healthcare=8, Other=45, Operations=1, Finance=1, Analytics=4
- Finance: Operations=8, Other=3, Finance=39, Sales=8, Marketing=1, Accounting=1, Analytics=2, IT_Software=1, ProductManagement=1
- HR: HR=25, Marketing=1, Sales=3, Consulting=2, Accounting=1, Analytics=2, IT_Software=1, Other=1
- Healthcare: Healthcare=4
- IT_Software: IT_Software=25, Marketing=5, Engineering=4, Analytics=2
- Legal: Operations=8, Marketing=4, ProductManagement=1, Other=3, Consulting=1, Legal=7, Sales=1, Finance=5, Engineering=2, Analytics=2, Government=1
- Marketing: Marketing=172, Sales=7, Operations=9, Analytics=7, ProductManagement=1, Consulting=3, Finance=3, Other=1
- Operations: Marketing=4, Operations=41, Other=1, Sales=1, Analytics=1, Consulting=1, HR=1
- Other: Operations=6, IT_Software=1, Consulting=1, Marketing=6, Other=3, Government=1, Analytics=1
- ProductManagement: ProductManagement=11
- Sales: Marketing=14, Sales=17, Operations=6, IT_Software=2, Healthcare=3, Government=2, HR=1, Engineering=1, Finance=2
- Trades: Engineering=4
