import { defineGradeSpec } from '../../grader/grade-spec';
import { gradeEx1 } from './checks';

// One test per submission; the submission-procedure checks are added by defineGradeSpec.
defineGradeSpec('ex1', gradeEx1);
