import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { INSERT_AFTER_PARAM, useInsertSlide } from '../hooks/useInsertSlide';
import { useViewerData } from '../state/viewer-data';
import { useViewerToast } from '../state/viewer-toast';

/** `?msError=` from the login callback, when the write login did not work out. */
const LOGIN_ERRORS: Record<string, string> = {
  denied: 'Ohne Schreibzugriff kann Slider keine Folie in die PowerPoint einfügen.',
  admin_consent:
    'Deine Organisation muss Slider den Schreibzugriff erst freigeben (Admin-Zustimmung). Bis dahin lassen sich keine Folien einfügen.',
  failed: 'Die Anmeldung bei Microsoft hat nicht geklappt. Versuche es noch einmal.',
};

/**
 * Back from the Microsoft write login (BER-128): finishes the ⊕ click that sent the owner there
 * (`?insertAfter=`), or explains why the login failed (`?msError=`). Runs once; both parameters
 * leave the URL right away so a reload doesn't insert a second slide.
 */
export function ResumeSlideInsert() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { canInsertSlides, slideIndex } = useViewerData();
  const insert = useInsertSlide();
  const showToast = useViewerToast();
  const done = useRef(false);

  const afterSlideId = searchParams.get(INSERT_AFTER_PARAM);
  const loginError = searchParams.get('msError');

  useEffect(() => {
    if (done.current || (!afterSlideId && !loginError)) return;
    done.current = true;
    setSearchParams(
      (params) => {
        params.delete(INSERT_AFTER_PARAM);
        params.delete('msError');
        return params;
      },
      { replace: true, preventScrollReset: true },
    );
    if (loginError) {
      showToast(LOGIN_ERRORS[loginError] ?? LOGIN_ERRORS.failed!, 'danger');
    } else if (afterSlideId && canInsertSlides && slideIndex.has(afterSlideId)) {
      insert.run(afterSlideId, { redirectToLogin: false });
    }
  }, [afterSlideId, loginError, canInsertSlides, slideIndex, setSearchParams, showToast, insert]);

  return null;
}
