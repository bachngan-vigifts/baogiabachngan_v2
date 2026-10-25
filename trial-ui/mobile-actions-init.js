import {installMobileDesign} from './mobile-design.js';
import {mobileProfilesP1} from './mobile-profiles-p1.js';
import {mobileProfilesP2} from './mobile-profiles-p2.js';
import {installMobileActions} from './mobile-actions.js';
installMobileDesign([...mobileProfilesP1,...mobileProfilesP2]);
installMobileActions();
