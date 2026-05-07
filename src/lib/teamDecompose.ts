// Moved to aiSuggest/teamDecompose.ts. Re-export so any out-of-tree caller
// keeps working; in-tree imports should be migrated to the new path.
export {
  decomposeWithAi,
  type Decomposed,
  type DecomposedRosterRow,
} from "./aiSuggest/teamDecompose";
