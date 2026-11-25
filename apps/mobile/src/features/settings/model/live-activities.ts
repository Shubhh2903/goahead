import { switchPreference } from "./secure-preference";

const preference = switchPreference("goahead.mobile.live-activities.v1", true);

export const useLiveActivitiesPreference = preference.store;
export const loadLiveActivitiesPreference = preference.load;
export const saveLiveActivitiesPreference = preference.save;
