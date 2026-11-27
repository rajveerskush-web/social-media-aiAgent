type SpecialistModelSelection = {
  agentId: string;
  defaultModel: string;
  selectedSpecialistId?: string;
  testModel?: string;
  specialistIds: readonly string[];
};

export function selectSpecialistModel({
  agentId,
  defaultModel,
  selectedSpecialistId,
  testModel,
  specialistIds,
}: SpecialistModelSelection) {
  if (!selectedSpecialistId || agentId !== selectedSpecialistId || !specialistIds.includes(selectedSpecialistId)) {
    return defaultModel;
  }

  return testModel?.trim() || defaultModel;
}
