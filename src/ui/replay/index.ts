/**
 * REPLAY harbor panes, registered as harbor tabs (FLOW renders registered panes; see src/ui/screens/harborPanes.ts).
 * Imported once for its side effects (GameApp imports it); also exports the panes for the lab page.
 */
import '../../styles/replay.css';
import { registerHarborPane } from '../screens/harborPanes';
import { LogbookPane, QuestsPane, VoyagePane } from './panes';

export { LogbookPane, QuestsPane, VoyagePane };

registerHarborPane(new VoyagePane());
registerHarborPane(new QuestsPane());
registerHarborPane(new LogbookPane());
