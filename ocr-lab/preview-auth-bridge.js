/* Opt-in bridge for a future authenticated receipt confirmation surface.
 * Importing this module never initializes Google Identity or contacts GAS.
 * The caller must explicitly invoke load() after a user action.
 * Keep the public OCR lab's local-only preview unchanged.
 */
import {createAuthenticatedCatalogConnector} from './authenticated-catalog.js';

export function createAuthenticatedPreviewBridge({auth,api,confirmation}){
 if(!auth||typeof auth.status!=='function'||typeof auth.subscribe!=='function'||
    !confirmation||typeof confirmation.loadAuthenticatedCatalog!=='function'||
    typeof confirmation.clearAuthenticatedCatalog!=='function')
  throw Error('CATALOG_BRIDGE_UNAVAILABLE');
 const connector=createAuthenticatedCatalogConnector({auth,api});
 let revision=0,subject=null,disposed=false;
 const onAuthChanged=state=>{
  if(subject&&(!state?.signedIn||state.subject!==subject)){
   revision++;subject=null;
   confirmation.clearAuthenticatedCatalog();
  }
 };
 const unsubscribe=auth.subscribe(onAuthChanged);
 if(typeof unsubscribe!=='function')throw Error('CATALOG_BRIDGE_UNAVAILABLE');
 return {
  async load(){
   if(disposed)throw Error('CATALOG_BRIDGE_DISPOSED');
   const session=auth.status();
   if(!session?.signedIn||typeof session.subject!=='string'||!session.subject)
    throw Error('LOGIN_REQUIRED');
   const request=++revision,expectedSubject=session.subject;
   subject=expectedSubject;
   try{
    const loaded=await confirmation.loadAuthenticatedCatalog(connector);
    if(request!==revision)return false;
    const now=auth.status();
    if(disposed||!now?.signedIn||now.subject!==expectedSubject)
     throw Error('AUTH_SESSION_CHANGED');
    return loaded;
   }catch(error){
    if(request!==revision)return false; // superseded request must not erase a newer result
    subject=null;
    confirmation.clearAuthenticatedCatalog();
    throw error;
   }
  },
  dispose(){
   if(disposed)return;
   disposed=true;revision++;subject=null;unsubscribe();
   confirmation.clearAuthenticatedCatalog();
  }
 };
}
