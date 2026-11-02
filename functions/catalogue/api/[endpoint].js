import {handleApi} from '../../../catalogue-server/api.mjs';
export const onRequest = ({request}) => handleApi(request);
