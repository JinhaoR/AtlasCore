/** Read-only UI fence around transient housekeeping. No operation is retried here. */
export async function readVerifiedController(query, pause = () => new Promise(resolve => setTimeout(resolve, 50))) {
    for (let attempt = 0; attempt < 21; attempt++) {
        let view;
        try {
            view = await query();
        }
        catch {
            return null;
        }
        if (view?.status === 'READY' && view.snapshot != null)
            return view;
        if (view == null || !['LOADING', 'COMMITTING'].includes(view.status) || attempt === 20)
            return null;
        await pause();
    }
    return null;
}
