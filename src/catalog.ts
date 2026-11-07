import { readFileSync } from 'node:fs';
import { config } from './config.js';
import { mediaUrl } from './media.js';

export interface RawExercise {
  id: string;
  name: string;
  category: string;
  body_part: string;
  equipment: string;
  instructions: Record<string, string>;
  instruction_steps: Record<string, string[]>;
  muscle_group: string;
  secondary_muscles: string[];
  target: string;
  media_id: string;
  image: string;
  gif_url: string;
  attribution: string;
  created_at: string;
}

export interface ExerciseSummary {
  id: string;
  name: string;
  bodyPart: string;
  equipment: string;
  target: string;
  muscleGroup: string;
  secondaryMuscles: string[];
  imageUrl: string;
  gifUrl: string;
  attribution: string;
}

export interface ExerciseDetail extends ExerciseSummary {
  language: string;
  instructions: string;
  steps: string[];
}

export interface CatalogFilters {
  search?: string;
  bodyPart?: string;
  equipment?: string;
  target?: string;
  muscleGroup?: string;
  limit: number;
  offset: number;
}

const ATTRIBUTION = '© Gym visual — https://gymvisual.com/';

const raw = JSON.parse(readFileSync(config.dataFile, 'utf8')) as RawExercise[];

if (!Array.isArray(raw) || raw.length === 0) {
  throw new Error(`No se pudo cargar el catálogo desde ${config.dataFile}`);
}

const byId = new Map(raw.map((exercise) => [exercise.id, exercise]));
if (byId.size !== raw.length) {
  throw new Error('El catálogo contiene IDs de ejercicio duplicados');
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

const bodyParts = uniqueSorted(raw.map((exercise) => exercise.body_part));
const equipment = uniqueSorted(raw.map((exercise) => exercise.equipment));
const targets = uniqueSorted(raw.map((exercise) => exercise.target));
const muscleGroups = uniqueSorted(raw.map((exercise) => exercise.muscle_group));
const languages = uniqueSorted(Object.keys(raw[0]?.instructions ?? {}));

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

export function hasLanguage(language: string): boolean {
  return languages.includes(language);
}

export function catalogMeta() {
  return {
    total: raw.length,
    bodyParts,
    equipment,
    targets,
    muscleGroups,
    languages,
    attribution: ATTRIBUTION,
  };
}

export function findExercise(id: string): RawExercise | undefined {
  return byId.get(id);
}

export function toExerciseSummary(exercise: RawExercise, baseUrl: string): ExerciseSummary {
  return {
    id: exercise.id,
    name: exercise.name,
    bodyPart: exercise.body_part,
    equipment: exercise.equipment,
    target: exercise.target,
    muscleGroup: exercise.muscle_group,
    secondaryMuscles: exercise.secondary_muscles,
    imageUrl: mediaUrl(baseUrl, exercise.image),
    gifUrl: mediaUrl(baseUrl, exercise.gif_url),
    attribution: exercise.attribution || ATTRIBUTION,
  };
}

export function toExerciseDetail(
  exercise: RawExercise,
  language: string,
  baseUrl: string
): ExerciseDetail {
  const instructions =
    exercise.instructions[language] ?? exercise.instructions.en ?? '';
  const steps =
    exercise.instruction_steps[language] ?? exercise.instruction_steps.en ?? [];
  return {
    ...toExerciseSummary(exercise, baseUrl),
    language,
    instructions,
    steps,
  };
}

export function listExercises(
  filters: CatalogFilters,
  baseUrl: string
): { data: ExerciseSummary[]; total: number } {
  const search = filters.search ? normalize(filters.search) : null;
  const bodyPart = filters.bodyPart?.toLowerCase();
  const equipmentFilter = filters.equipment?.toLowerCase();
  const target = filters.target?.toLowerCase();
  const muscleGroup = filters.muscleGroup?.toLowerCase();

  const filtered = raw.filter((exercise) => {
    if (bodyPart && exercise.body_part.toLowerCase() !== bodyPart) {
      return false;
    }
    if (equipmentFilter && exercise.equipment.toLowerCase() !== equipmentFilter) {
      return false;
    }
    if (target && exercise.target.toLowerCase() !== target) {
      return false;
    }
    if (muscleGroup && exercise.muscle_group.toLowerCase() !== muscleGroup) {
      return false;
    }
    if (search) {
      const haystack = normalize(
        [
          exercise.name,
          exercise.target,
          exercise.muscle_group,
          exercise.equipment,
          exercise.body_part,
        ].join(' ')
      );
      if (!haystack.includes(search)) {
        return false;
      }
    }
    return true;
  });

  filtered.sort((a, b) => a.name.localeCompare(b.name));

  return {
    data: filtered
      .slice(filters.offset, filters.offset + filters.limit)
      .map((exercise) => toExerciseSummary(exercise, baseUrl)),
    total: filtered.length,
  };
}

export function fallbackSummary(exerciseId: string): ExerciseSummary {
  return {
    id: exerciseId,
    name: exerciseId,
    bodyPart: 'unknown',
    equipment: 'unknown',
    target: 'unknown',
    muscleGroup: 'unknown',
    secondaryMuscles: [],
    imageUrl: '',
    gifUrl: '',
    attribution: ATTRIBUTION,
  };
}
