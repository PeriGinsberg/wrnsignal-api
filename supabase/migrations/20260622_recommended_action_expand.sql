ALTER TABLE coach_job_recommendations
  DROP CONSTRAINT coach_job_recommendations_recommended_action_check;

ALTER TABLE coach_job_recommendations
  ADD CONSTRAINT coach_job_recommendations_recommended_action_check
  CHECK (recommended_action IN ('apply','research_first','tailor_resume','reach_out_first','hold','skip'));
