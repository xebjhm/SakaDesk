import { createContext, useContext } from 'react';

/** False while a kept-mounted feature (Messages) is hidden behind another one (ContentArea). */
export const FeatureActiveContext = createContext(true);

export const useFeatureActive = (): boolean => useContext(FeatureActiveContext);
