import {useSyncExternalStore} from "react";
import {catalogRevision,subscribeCatalog} from "../domain/datasets";
export function useCatalogRevision(){return useSyncExternalStore(subscribeCatalog,catalogRevision);}
