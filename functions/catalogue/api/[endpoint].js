import {handleApi} from '../../../catalogue-server/api.mjs';
import {secureCatalogueApi} from '../../../catalogue-server/security.mjs';
export const onRequest = ({request,env}) => secureCatalogueApi(request,env,handleApi);
