/*
 * Copyright (c) "Neo4j"
 * Neo4j Sweden AB [http://neo4j.com]
 *
 * This file is part of Neo4j.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import Cypher from "@neo4j/cypher-builder";
import Debug from "debug";
import type { Node } from "../classes";
import { CallbackBucket } from "../classes/CallbackBucket";
import { DEBUG_TRANSLATE } from "../constants";
import type { GraphQLWhereArg } from "../types";
import type { Neo4jGraphQLTranslationContext } from "../types/neo4j-graphql-translation-context";
import { compileCypher } from "../utils/compile-cypher";
import createUpdateAndParams from "./create-update-and-params";
import { QueryASTContext, QueryASTEnv } from "./queryAST/ast/QueryASTContext";
import { QueryASTFactory } from "./queryAST/factory/QueryASTFactory";
import { translateTopLevelMatch } from "./translate-top-level-match";

const debug = Debug(DEBUG_TRANSLATE);

export default async function translateUpdate({
    node,
    context,
}: {
    node: Node;
    context: Neo4jGraphQLTranslationContext;
}): Promise<[string, any]> {
    const { resolveTree } = context;
    const updateInput = resolveTree.args.update;
    const varName = "this";
    const callbackBucket: CallbackBucket = new CallbackBucket(context);
    const withVars = [varName];

    let matchAndWhereStr = "";
    let updateStr = "";
    const matchNode = new Cypher.NamedNode(varName);
    const where = resolveTree.args.where as GraphQLWhereArg | undefined;
    const matchPattern = new Cypher.Pattern(matchNode, { labels: node.getLabels(context) });
    const topLevelMatch = translateTopLevelMatch({
        matchNode,
        matchPattern,
        node,
        context,
        operation: "UPDATE",
        where,
    });
    matchAndWhereStr = topLevelMatch.cypher;
    let cypherParams = topLevelMatch.params;

    const connectionStrs: string[] = [];
    const interfaceStrs: string[] = [];
    let updateArgs = {};

    if (updateInput) {
        const updateAndParams = createUpdateAndParams({
            context,
            callbackBucket,
            node,
            updateInput,
            varName,
            parentVar: varName,
            withVars,
            parameterPrefix: `${resolveTree.name}.args.update`,
        });
        [updateStr] = updateAndParams;
        cypherParams = {
            ...cypherParams,
            ...updateAndParams[1],
        };
        updateArgs = {
            ...updateArgs,
            ...(updateStr.includes(resolveTree.name) ? { update: updateInput } : {}),
        };
    }

    const entityAdapter = context.schemaModel.getConcreteEntityAdapter(node.name);
    if (!entityAdapter) {
        throw new Error(`Transpilation error: ${node.name} is not a concrete entity`);
    }

    const queryAST = new QueryASTFactory(context.schemaModel).createQueryAST({
        resolveTree,
        entityAdapter,
        context,
    });
    const queryASTEnv = new QueryASTEnv();

    const queryASTContext = new QueryASTContext({
        target: new Cypher.NamedNode(varName),
        env: queryASTEnv,
        neo4jGraphQLContext: context,
        returnVariable: new Cypher.NamedVariable("data"),
        shouldCollect: true,
        shouldDistinct: true,
    });
    debug(queryAST.print());
    const queryASTResult = queryAST.transpile(queryASTContext);

    const projectionStatements = queryASTResult.clauses.length
        ? Cypher.utils.concat(...queryASTResult.clauses)
        : new Cypher.Return(new Cypher.Literal("Query cannot conclude with CALL"));

    const updateQuery = new Cypher.Raw((env) => {
        const cypher = [
            matchAndWhereStr,
            updateStr,
            ...(isFollowedByASubquery(projectionStatements) ? [`WITH *`] : []), // When FOREACH is the last line of update 'Neo4jError: WITH is required between FOREACH and CALL'
            ...connectionStrs,
            ...interfaceStrs,
            compileCypher(projectionStatements, env),
        ]
            .filter(Boolean)
            .join("\n");

        return [
            cypher,
            {
                ...cypherParams,
                ...(Object.keys(updateArgs).length ? { [resolveTree.name]: { args: updateArgs } } : {}),
            },
        ];
    });

    const cypherResult = updateQuery.build({ prefix: "update_" });
    const { cypher, params: resolvedCallbacks } = await callbackBucket.resolveCallbacksAndFilterCypher({
        cypher: cypherResult.cypher,
    });
    const result: [string, Record<string, any>] = [cypher, { ...cypherResult.params, resolvedCallbacks }];
    return result;
}

/**
 * Temporary helper to keep consistency with the old code where if a subquery was present, it would be followed by a WITH *.
 * The recursion is needed because the subquery can be wrapped inside a Cypher.Composite.
 **/
function isFollowedByASubquery(clause): boolean {
    if (clause.children?.length) {
        if (clause.children[0] instanceof Cypher.Call) {
            return true;
        }
        if (clause.children[0]?.children?.length) {
            return isFollowedByASubquery(clause.children[0]);
        }
    }
    return false;
}
